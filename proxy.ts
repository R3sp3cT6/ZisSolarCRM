import {NextRequest, NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {contentSecurityPolicy} from './lib/request-security';

export function proxy(request: NextRequest) {
  const nonce = randomBytes(32).toString('base64');
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  // Always overwrite caller-supplied nonce/CSP values.
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({request: {headers}});
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {matcher: ['/', '/login', '/account', '/settings', '/api/:path*']};
