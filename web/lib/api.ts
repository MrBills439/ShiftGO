import axios from 'axios';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const api = axios.create({ baseURL: BASE, timeout: 12000 });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('shiftgo_access');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = localStorage.getItem('shiftgo_refresh');
        const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken: refresh });
        localStorage.setItem('shiftgo_access', data.data.accessToken);
        localStorage.setItem('shiftgo_refresh', data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('shiftgo_access');
        localStorage.removeItem('shiftgo_refresh');
        localStorage.removeItem('shiftgo_user');
        if (typeof window !== 'undefined') window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
