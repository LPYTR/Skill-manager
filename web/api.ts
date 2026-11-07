let session: Promise<string> | undefined;
export class ApiError extends Error { constructor(message: string, public code: string, public details?: unknown, public data?: unknown) { super(message); } }
export async function api<T = unknown>(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  session ||= fetch('/api/session').then(async response => { const result = await response.json(); if (!result.ok) throw new Error(result.error?.message || '无法连接本机服务'); return result.data.token; }).catch(error => { session = undefined; throw error; });
  const response = await fetch(`/api/${url}`, { method, headers: { 'x-skill-manager-token': await session, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!result.ok) { if (result.error?.code === 'SESSION_REQUIRED') session = undefined; throw new ApiError(result.error?.message || '操作失败', result.error?.code, result.error?.details, result.data); }
  return result.data as T;
}
