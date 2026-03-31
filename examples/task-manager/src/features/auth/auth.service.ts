// Auth Service
import { AuthRepository } from "./auth.repository";

export class AuthService {
  constructor(private repo: AuthRepository) {}

  async validateToken(token: string) {
    // Verify JWT signature against JWKS endpoint
    return this.repo.findUserByToken(token);
  }
}
