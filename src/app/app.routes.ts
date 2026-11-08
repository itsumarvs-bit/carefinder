import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './core/auth.guards';

export const routes: Routes = [
  { path: 'home', loadComponent: () => import('./home/home.page').then((m) => m.HomePage) },
  { path: 'map', loadComponent: () => import('./pages/map/map.page').then((m) => m.MapPage) },
  { path: 'favorites', canActivate: [authGuard], loadComponent: () => import('./pages/favorites/favorites.page').then((m) => m.FavoritesPage) },
  { path: 'profile', loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage) },
  { path: 'auth', loadComponent: () => import('./pages/auth/auth.page').then((m) => m.AuthPage) },
  { path: 'facility/:id', loadComponent: () => import('./pages/facility-details/facility-details.page').then((m) => m.FacilityDetailsPage) },
  { path: 'admin/import', canActivate: [adminGuard], loadComponent: () => import('./pages/admin/import-facilities.page').then((m) => m.ImportFacilitiesPage) },
  { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./pages/admin/admin.page').then((m) => m.AdminPage) },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];
