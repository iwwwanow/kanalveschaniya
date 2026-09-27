// 1:1 with account (account.proxyId), enforced by a UNIQUE(service_id, proxy_id) constraint on
// accounts — one proxy can't sit behind two accounts of the SAME service (IP correlation risk),
// but can be reused across different services. No rotation/allocation logic in v1 — proxies are
// provisioned manually alongside accounts (see AccountRepository.tryStartRefresh's scope note).
export interface Proxy {
  id: number;
  url: string; // socks5://... connection string
}

export interface ProxyRepository {
  findById(id: number): Promise<Proxy | null>;
}
