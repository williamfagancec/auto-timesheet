import 'fastify'
import '@fastify/cookie'

declare module 'fastify' {
  interface FastifyRequest {
    cookies: { [key: string]: string | undefined }
  }

  interface FastifyReply {
    setCookie(
      name: string,
      value: string,
      options?: {
        domain?: string
        expires?: Date
        httpOnly?: boolean
        maxAge?: number
        path?: string
        sameSite?: boolean | 'lax' | 'strict' | 'none'
        secure?: boolean
        signed?: boolean
      }
    ): this
    clearCookie(name: string, options?: { path?: string; domain?: string }): this
  }
}
