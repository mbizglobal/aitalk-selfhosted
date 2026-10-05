import { NextRequest } from 'next/server';
import { VENDOR_ADMIN_IPV4_RANGES, VENDOR_ADMIN_IPV6_PREFIXES } from '@/lib/vendor-network';

export function getClientIP(request: NextRequest): string {
  // Try various headers to get the real IP
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, get the first one
    const ips = forwarded.split(',').map(ip => ip.trim());
    return ips[0];
  }
  
  if (realIP) {
    return realIP;
  }
  
  // Fallback to localhost
  return '127.0.0.1';
}

const ADMIN_ALLOWED_RANGES = VENDOR_ADMIN_IPV4_RANGES;
const ADMIN_ALLOWED_IPV6_PREFIXES = VENDOR_ADMIN_IPV6_PREFIXES;

export function isIPAllowed(clientIP: string): boolean {
  // Normalize IPv6-mapped IPv4
  let normalizedIP = clientIP;
  if (clientIP.startsWith('::ffff:')) {
    normalizedIP = clientIP.substring(7);
  }

  if (normalizedIP === '127.0.0.1' || clientIP === '::1') return true;

  const allowedIPs = process.env.ADMIN_ALLOWED_IPS?.split(',').map(ip => ip.trim()) || [];
  const expandedIPs = allowedIPs.flatMap(ip =>
    ip.toLowerCase() === 'localhost' ? ['127.0.0.1', '::1', '::ffff:127.0.0.1'] : [ip]
  );
  if (expandedIPs.includes(clientIP) || expandedIPs.includes(normalizedIP)) return true;

  if (normalizedIP.includes(':')) {
    const lower = normalizedIP.toLowerCase();
    for (const prefix of ADMIN_ALLOWED_IPV6_PREFIXES) {
      if (lower.startsWith(prefix)) return true;
    }
    console.warn(`Admin access denied for IP: ${clientIP} (IPv6 prefix not matched)`);
    return false;
  }

  const parsed = parseIPv4(normalizedIP);
  if (parsed) {
    for (const range of ADMIN_ALLOWED_RANGES) {
      if (isIPInRange(parsed, range.start, range.end)) return true;
    }
  }

  console.warn(`Admin access denied for IP: ${clientIP} (normalized: ${normalizedIP})`);
  return false;
}

const CONSOLE_ALLOWED_RANGES = VENDOR_ADMIN_IPV4_RANGES;
const CONSOLE_ALLOWED_IPV6_PREFIXES = VENDOR_ADMIN_IPV6_PREFIXES;

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isIPInRange(ip: number[], start: number[], end: number[]): boolean {
  for (let i = 0; i < 4; i++) {
    if (ip[i] < start[i]) return false;
    if (ip[i] > end[i]) return false;
  }
  return true;
}

export function isConsoleIPAllowed(clientIP: string): boolean {
  // Normalize IPv6-mapped IPv4
  let normalizedIP = clientIP;
  if (clientIP.startsWith('::ffff:')) {
    normalizedIP = clientIP.substring(7);
  }

  // Allow localhost for development
  if (normalizedIP === '127.0.0.1' || clientIP === '::1') {
    return true;
  }

  // Check IPv6 prefixes (ngrok sends pure IPv6 via x-forwarded-for)
  if (normalizedIP.includes(':')) {
    const lowerIP = normalizedIP.toLowerCase();
    for (const prefix of CONSOLE_ALLOWED_IPV6_PREFIXES) {
      if (lowerIP.startsWith(prefix)) {
        return true;
      }
    }
    console.warn(`Console access denied for IP: ${clientIP} (IPv6, no matching prefix)`);
    return false;
  }

  // Try parsing as IPv4
  const parsed = parseIPv4(normalizedIP);
  if (!parsed) {
    console.warn(`Console access denied for IP: ${clientIP} (invalid format)`);
    return false;
  }

  for (const range of CONSOLE_ALLOWED_RANGES) {
    if (isIPInRange(parsed, range.start, range.end)) {
      return true;
    }
  }

  console.warn(`Console access denied for IP: ${clientIP} (normalized: ${normalizedIP})`);
  return false;
}