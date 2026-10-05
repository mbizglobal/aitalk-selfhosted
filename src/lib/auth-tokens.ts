import { randomBytes, createHash } from 'crypto'

export interface VerificationToken {
  identifier: string
  token: string
  expires: Date
}

export class AuthTokenService {
  private readonly EXPIRY_HOURS = 24
  private readonly PASSWORD_RESET_EXPIRY_HOURS = 1
  
  generateVerificationToken(email: string) {
    const rawToken = randomBytes(32).toString('hex')
    
    const hashedToken = createHash('sha256').update(rawToken).digest('hex')
    
    const expires = new Date()
    expires.setHours(expires.getHours() + this.EXPIRY_HOURS)
    
    return {
      token: rawToken,
      hashedToken,
      expires
    }
  }
  
  generatePasswordResetToken(email: string) {
    const rawToken = randomBytes(32).toString('hex')
    
    const hashedToken = createHash('sha256').update(rawToken).digest('hex')
    
    const expires = new Date()
    expires.setHours(expires.getHours() + this.PASSWORD_RESET_EXPIRY_HOURS)
    
    return {
      token: rawToken,
      hashedToken,
      expires
    }
  }
  
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
  
  isTokenExpired(expires: Date): boolean {
    return new Date() > expires
  }
  
  verifyToken(rawToken: string, storedToken: string, expires: Date): {
    valid: boolean
    expired: boolean
    message: string
  } {
    const hashedInputToken = this.hashToken(rawToken)
    
    if (this.isTokenExpired(expires)) {
      return {
        valid: false,
        expired: true,
        message: '인증 토큰이 만료되었습니다. 새로운 인증 이메일을 요청해주세요.'
      }
    }
    
    if (hashedInputToken !== storedToken) {
      return {
        valid: false,
        expired: false,
        message: '유효하지 않은 인증 토큰입니다.'
      }
    }
    
    return {
      valid: true,
      expired: false,
      message: '인증이 완료되었습니다.'
    }
  }
}

export const authTokenService = new AuthTokenService()