import { handleAuthPost } from '../../../lib/auth-http.js';

export const prerender = false;

export function POST({ request }) {
  return handleAuthPost('register', request);
}
