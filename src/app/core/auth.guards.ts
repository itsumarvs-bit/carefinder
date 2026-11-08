import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await firstValueFrom(auth.user$);
  if (user) return true;
  return router.createUrlTree(['/auth'], { queryParams: { returnUrl: state.url } });
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await firstValueFrom(auth.user$);
  if (!user) return router.createUrlTree(['/auth']);
  if (await auth.hasAdminClaim()) return true;
  return router.createUrlTree(['/home']);
};
