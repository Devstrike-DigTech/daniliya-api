import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Attaches the user when a valid token is present, but allows anonymous
 * requests through. Pair with @Public() so the global JwtAuthGuard steps aside
 * and this one runs instead. Used for endpoints that work for guests but do
 * something extra when signed in (e.g. link a booking to the account).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // ignore — anonymous is allowed
    }
    return true;
  }

  handleRequest<TUser>(_err: unknown, user: TUser): TUser | null {
    return user ?? null;
  }
}
