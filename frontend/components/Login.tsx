import { useState } from 'react';
import { Eye, EyeOff, Gamepad2, Lock, User, AlertCircle } from 'lucide-react';
import { apiClient } from '../utils/api';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedError = error.trim().toLowerCase();
  const showError = Boolean(error);
  const isCredentialError =
    normalizedError.includes('invalid credential') ||
    normalizedError.includes('invalid username or password');
  const errorTitle = isCredentialError ? 'Incorrect username or password' : 'Unable to sign in';
  const errorMessage = isCredentialError
    ? 'Please verify your login details and try again.'
    : error;

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error) setError('');
    setUsername(e.target.value);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error) setError('');
    setPassword(e.target.value);
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter both username and password');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.login(username, password);
      if (response.token) {
        onLogin();
        return;
      }
      setError('Unexpected login response');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = `w-full rounded-lg border py-2.5 pl-9 text-sm text-[#f1f0ff] placeholder:text-[#8280ad] transition-[border-color,box-shadow] focus:outline-none ${
    showError
      ? 'border-[#b9383f] bg-[#2a1220] focus:shadow-[0_0_0_3px_rgba(185,56,63,0.25)]'
      : 'border-[#3a3978] bg-[#131232] focus:border-[#5b4ff0] focus:shadow-[0_0_0_3px_rgba(91,79,240,0.25)]'
  }`;

  return (
    <div className="flex min-h-screen bg-[#0e0d24] p-0 lg:p-4">
      <div className="flex w-full flex-col justify-between px-6 py-8 sm:px-12 lg:w-[44%] lg:max-w-[560px]">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#5b4ff0] text-[#ffffff]">
            <Gamepad2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-bold text-[#f1f0ff]">Game Panel</span>
        </div>

        <div className="mx-auto w-full max-w-sm py-10">
          <h1 className="text-2xl font-bold tracking-tight text-[#f1f0ff]">Welcome back</h1>
          <p className="mt-1 text-sm text-[#9d9bc6]">Sign in to manage your game servers.</p>

          <form onSubmit={handleCredentialsSubmit} className="mt-8 space-y-5">
            {showError && (
              <div className="flex items-start gap-3 rounded-lg border border-[#b9383f]/60 bg-[#2a1220] p-3" role="alert">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#f0a3a7]" />
                <div>
                  <p className="text-sm font-semibold text-[#fbd5d7]">{errorTitle}</p>
                  <p className="mt-0.5 text-sm text-[#f0a3a7]">{errorMessage}</p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-sm font-medium text-[#c9c8e6]">
                Username
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-4 w-4 text-[#8280ad]" />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="Enter your username"
                  autoComplete="username"
                  className={`${inputClass} pr-4`}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-[#c9c8e6]">
                Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-4 w-4 text-[#8280ad]" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center border-none bg-transparent pr-3 text-[#8280ad] transition-colors hover:text-[#8b84ff]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`mt-2 w-full rounded-lg border-none py-2.5 text-sm font-semibold text-[#ffffff] transition-colors ${
                loading
                  ? 'cursor-not-allowed bg-[#3a3978]'
                  : 'cursor-pointer bg-[#5b4ff0] shadow-[0_6px_20px_rgba(91,79,240,0.35)] hover:bg-[#6a5ff5]'
              }`}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#6b6994]">© 2026 OVHcloud. All rights reserved.</p>
      </div>

      <div aria-hidden="true" className="relative hidden flex-1 overflow-hidden rounded-2xl lg:block">
        <LoginArtwork />
      </div>
    </div>
  );
}

/** Original layered-wave artwork for the login screen. */
function LoginArtwork() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="gp-login-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2a1f8f" />
          <stop offset="55%" stopColor="#1b1563" />
          <stop offset="100%" stopColor="#100c3d" />
        </linearGradient>
        <radialGradient id="gp-login-glow" cx="0.78" cy="0.12" r="0.7">
          <stop offset="0%" stopColor="#8b84ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#8b84ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gp-login-wave-a" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6a5ff5" />
          <stop offset="100%" stopColor="#4c40de" />
        </linearGradient>
        <linearGradient id="gp-login-wave-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a29bff" />
          <stop offset="100%" stopColor="#6a5ff5" />
        </linearGradient>
      </defs>
      <rect width="800" height="900" fill="url(#gp-login-bg)" />
      <rect width="800" height="900" fill="url(#gp-login-glow)" />
      <path d="M0 520 C 140 420, 260 600, 420 500 S 680 380, 800 460 L 800 900 L 0 900 Z" fill="url(#gp-login-wave-a)" opacity="0.55" />
      <path d="M0 600 C 170 520, 300 700, 470 610 S 700 520, 800 580 L 800 900 L 0 900 Z" fill="url(#gp-login-wave-b)" opacity="0.5" />
      <path d="M0 700 C 150 640, 320 780, 500 700 S 720 640, 800 690 L 800 900 L 0 900 Z" fill="#3a2fc4" opacity="0.75" />
      <path d="M0 790 C 180 740, 360 850, 560 790 S 740 760, 800 780 L 800 900 L 0 900 Z" fill="#1b1563" opacity="0.85" />
    </svg>
  );
}
