import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    usuarioSesion?: { userId: string; rol: string; emisorId: string };
  }
}
