# %% [md]
# ## 1 · Mamba layer
# Uses the official CUDA kernels (`mamba_ssm`) when they are installed. Otherwise a pure-PyTorch implementation with the **same parameter names** is used, so checkpoints work with either. The fallback uses a log-space parallel scan: correct, but slower and more memory-hungry. On GPU runtimes the kernels are built from the GitHub main branch (which supports CUDA 13 and Blackwell) with uv, and the wheel is saved to `weights/wheels/` on Drive: the 10–40 min build happens once per PyTorch/CUDA/Python combination, later sessions just install the saved wheel. The full build log goes to `weights/build_logs/`.

# %%
INSTALL_MAMBA_KERNELS = not SMOKE and DEVICE == 'cuda'   # set False to force the PyTorch fallback
MambaCUDA = None


def build_wheel(pkg, repo, force_env, wheel_dir, log):
    """Build `pkg` from its GitHub main branch into a wheel stored on Drive (built once per torch/CUDA/Python)."""
    src = P['local'] / 'src' / pkg
    if not (src / 'setup.py').exists():
        sh(f'rm -rf "{src}" && git clone --depth 1 https://github.com/{repo} "{src}"', check=False, log=log)
    jobs = max(1, (os.cpu_count() or 2) - 1)
    env = f'{force_env}=TRUE MAX_JOBS={jobs} NVCC_THREADS=2'
    return sh(f'cd "{src}" && {env} uv build --wheel --no-build-isolation -o "{wheel_dir}"', check=False, timeout=5400, log=log) == 0


def install_mamba_kernels():
    tag = f"torch{torch.__version__.split('+')[0]}_cu{torch.version.cuda}_py{sys.version_info.major}{sys.version_info.minor}"
    wheel_dir = P['weights'] / 'wheels' / tag
    log_dir = P['weights'] / 'build_logs'
    wheel_dir.mkdir(parents=True, exist_ok=True); log_dir.mkdir(parents=True, exist_ok=True)
    print(f'wheel cache: {wheel_dir}')
    pip_install('ninja packaging setuptools wheel')
    for pkg, repo, force_env in (('causal_conv1d', 'Dao-AILab/causal-conv1d', 'CAUSAL_CONV1D_FORCE_BUILD'),
                                 ('mamba_ssm', 'state-spaces/mamba', 'MAMBA_FORCE_BUILD')):
        log = log_dir / f'{pkg}_{tag}.log'
        cached = sorted(wheel_dir.glob(f'{pkg}-*.whl'))
        if not cached:
            print(f'\n=== building {pkg} from github.com/{repo} (main) — 10–40 min, once; full log: {log}')
            if not build_wheel(pkg, repo, force_env, wheel_dir, log):
                errs = [l.rstrip() for l in open(log, errors='replace') if re.search(r'(error|fatal)\b', l, re.I) and 'warning' not in l.lower()]
                print(f'\n=== {pkg} build failed. Compiler errors ({len(errs)} lines, first 40):')
                print('\n'.join(errs[:40]))
                return False
            cached = sorted(wheel_dir.glob(f'{pkg}-*.whl'))
        if pip_install(f'"{cached[-1]}"') != 0:
            return False
    return True


try:
    from mamba_ssm import Mamba as MambaCUDA
except Exception:
    if INSTALL_MAMBA_KERNELS:
        try:
            if install_mamba_kernels():
                import importlib; importlib.invalidate_caches()
                from mamba_ssm import Mamba as MambaCUDA
        except Exception as e:
            print('mamba_ssm unavailable, using the PyTorch fallback:', str(e)[:300])
print('Mamba backend:', 'mamba_ssm CUDA kernels' if MambaCUDA else 'PyTorch fallback')


def _scan(u, delta, A, B, C, D):
    """Selective scan h_t = exp(dt*A) h_{t-1} + dt*B_t*u_t, y_t = C_t·h_t + D*u_t.
    Log-space parallel scan (Heinsen 2023) with positive/negative parts kept apart.
    u, delta: (b, l, d) · A: (d, n) · B, C: (b, l, n)."""
    u, delta, B, C = u.float(), delta.float(), B.float(), C.float()
    log_a = delta.unsqueeze(-1) * A                                   # (b,l,d,n), <= 0
    a_star = torch.cumsum(log_a, dim=1)
    bx = (delta * u).unsqueeze(-1) * B.unsqueeze(2)                   # (b,l,d,n)
    tiny = torch.finfo(torch.float32).tiny
    lp = torch.log(bx.clamp(min=0) + tiny) - a_star
    ln = torch.log((-bx).clamp(min=0) + tiny) - a_star
    h = torch.exp(a_star + torch.logcumsumexp(lp, dim=1)) - torch.exp(a_star + torch.logcumsumexp(ln, dim=1))
    y = (h * C.unsqueeze(2)).sum(-1) + u * D
    return y


def _scan_seq(u, delta, A, B, C, D):
    """Same recurrence, step by step: never materialises (b, l, d, n). Faster for short sequences (L <= 64)."""
    u, delta, B, C = u.float(), delta.float(), B.float(), C.float()
    b, l, d = u.shape
    h = u.new_zeros(b, d, A.shape[1])
    ys = []
    for t in range(l):
        h = torch.exp(delta[:, t, :, None] * A) * h + (delta[:, t] * u[:, t])[..., None] * B[:, t, None, :]
        ys.append(torch.einsum('bdn,bn->bd', h, C[:, t]))
    return torch.stack(ys, 1) + u * D


class MambaTorch(nn.Module):
    """Pure-PyTorch Mamba (v1) block, parameter-compatible with mamba_ssm.Mamba."""
    def __init__(self, d_model, d_state=16, d_conv=4, expand=2, dt_rank='auto', dt_min=0.001, dt_max=0.1,
                 dt_init_floor=1e-4, conv_bias=True, bias=False, chunk=2048):
        super().__init__()
        self.d_inner = int(expand * d_model)
        self.d_state = d_state
        self.dt_rank = math.ceil(d_model / 16) if dt_rank == 'auto' else dt_rank
        self.chunk = chunk
        self.in_proj = nn.Linear(d_model, 2 * self.d_inner, bias=bias)
        self.conv1d = nn.Conv1d(self.d_inner, self.d_inner, d_conv, groups=self.d_inner, padding=d_conv - 1, bias=conv_bias)
        self.x_proj = nn.Linear(self.d_inner, self.dt_rank + 2 * d_state, bias=False)
        self.dt_proj = nn.Linear(self.dt_rank, self.d_inner, bias=True)
        dt_init_std = self.dt_rank ** -0.5
        nn.init.uniform_(self.dt_proj.weight, -dt_init_std, dt_init_std)
        dt_ = torch.exp(torch.rand(self.d_inner) * (math.log(dt_max) - math.log(dt_min)) + math.log(dt_min)).clamp(min=dt_init_floor)
        with torch.no_grad():
            self.dt_proj.bias.copy_(dt_ + torch.log(-torch.expm1(-dt_)))
        A = torch.arange(1, d_state + 1, dtype=torch.float32).repeat(self.d_inner, 1)
        self.A_log = nn.Parameter(torch.log(A))
        self.D = nn.Parameter(torch.ones(self.d_inner))
        self.out_proj = nn.Linear(self.d_inner, d_model, bias=bias)

    def forward(self, x):                      # (b, l, d_model)
        b, l, _ = x.shape
        xz = self.in_proj(x)
        u, z = xz.chunk(2, dim=-1)
        u = F.silu(self.conv1d(u.transpose(1, 2))[..., :l].transpose(1, 2))
        dbc = self.x_proj(u)
        dtr, Bm, Cm = dbc.split([self.dt_rank, self.d_state, self.d_state], dim=-1)
        delta = F.softplus(self.dt_proj(dtr))
        A = -torch.exp(self.A_log.float())
        # chunk the batch so the (b, l, d, n) scan tensors stay within memory
        scan = _scan_seq if l <= 64 else _scan
        budget = 4e8 if scan is _scan_seq else 6.4e7          # sequential scan keeps only (b, d, n) per step
        per = max(1, int(budget // ((1 if scan is _scan_seq else l) * self.d_inner * self.d_state)))
        # gradient checkpointing per chunk: the states are recomputed in backward, as the CUDA kernel does
        run = (lambda *a: torch.utils.checkpoint.checkpoint(scan, *a, use_reentrant=False)) if (self.training and torch.is_grad_enabled()) else scan
        ys = [run(u[i:i + per], delta[i:i + per], A, Bm[i:i + per], Cm[i:i + per], self.D.float()) for i in range(0, b, per)]
        y = torch.cat(ys, 0).to(x.dtype) * F.silu(z)
        return self.out_proj(y)


def make_mamba(d_model, d_state=16, d_conv=4, expand=2):
    if MambaCUDA is not None and DEVICE == 'cuda':
        return MambaCUDA(d_model=d_model, d_state=d_state, d_conv=d_conv, expand=expand)
    return MambaTorch(d_model, d_state=d_state, d_conv=d_conv, expand=expand)


def _check_scan():
    """The parallel scan must match a plain sequential recurrence."""
    torch.manual_seed(0)
    b, l, d, n = 2, 37, 8, 4
    u, delta = torch.randn(b, l, d), torch.rand(b, l, d) * 0.5
    A, Bm, Cm, D = -torch.rand(d, n) * 2, torch.randn(b, l, n), torch.randn(b, l, n), torch.randn(d)
    h = torch.zeros(b, d, n); ys = []
    for t in range(l):
        h = torch.exp(delta[:, t, :, None] * A) * h + (delta[:, t] * u[:, t])[..., None] * Bm[:, t, None, :]
        ys.append((h * Cm[:, t, None, :]).sum(-1) + u[:, t] * D)
    ref = torch.stack(ys, 1)
    err = max((ref - _scan(u, delta, A, Bm, Cm, D)).abs().max().item(), (ref - _scan_seq(u, delta, A, Bm, Cm, D)).abs().max().item())
    assert err < 1e-3, f'scan mismatch {err}'
    print(f'selective scan check passed (max error {err:.1e})')
_check_scan()
