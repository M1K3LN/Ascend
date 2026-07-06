import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { decryptSecret, encryptSecret } from "./crypto.server";

/**
 * Wraps PrismaSessionStorage so Shopify access tokens are AES-256-GCM
 * encrypted at rest and transparently decrypted on load. The Session objects
 * the app works with always carry plaintext tokens in memory only.
 */
export class EncryptedSessionStorage implements SessionStorage {
  constructor(private readonly inner: SessionStorage) {}

  async storeSession(session: Session): Promise<boolean> {
    const clone = new Session(session.toObject());
    if (clone.accessToken) {
      clone.accessToken = encryptSecret(clone.accessToken);
    }
    return this.inner.storeSession(clone);
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await this.inner.loadSession(id);
    if (session?.accessToken) {
      session.accessToken = decryptSecret(session.accessToken);
    }
    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.inner.deleteSession(id);
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.inner.findSessionsByShop(shop);
    for (const session of sessions) {
      if (session.accessToken) session.accessToken = decryptSecret(session.accessToken);
    }
    return sessions;
  }
}
