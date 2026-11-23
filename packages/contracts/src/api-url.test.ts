import { describe, expect, it } from 'vitest';
import { apiBaseFor, apiUrl, socketTarget, SOCKET_IO_PATH } from './api-url.js';

describe('api urls', () => {
  it('derives the API base from the site address', () => {
    expect(apiBaseFor('https://connect.example.com')).toBe('https://connect.example.com/api');
    expect(apiBaseFor('https://connect.example.com/')).toBe('https://connect.example.com/api');
    expect(apiBaseFor('https://connect.example.com/api/')).toBe('https://connect.example.com/api');
  });
  it('joins paths without dropping the /api prefix', () => {
    expect(apiUrl('https://x.test/api', '/v1/avatars/a')).toBe('https://x.test/api/v1/avatars/a');
    expect(apiUrl('/api', '/v1/me')).toBe('/api/v1/me');
    expect(apiUrl('/api/', 'v1/me')).toBe('/api/v1/me');
    expect(apiUrl('/api', 'https://cdn.test/a.png')).toBe('https://cdn.test/a.png');
    expect(apiUrl('/api', 'blob:https://x/1')).toBe('blob:https://x/1');
  });
  it('splits a base into socket origin and engine path', () => {
    expect(socketTarget('https://x.test/api')).toEqual({
      url: 'https://x.test',
      path: SOCKET_IO_PATH,
    });
    expect(socketTarget('/api', 'https://app.test')).toEqual({
      url: 'https://app.test',
      path: '/api/socket.io',
    });
  });
});
