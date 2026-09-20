### domain-entities

- sessoin

is it needed?

- proxy
- account

### application-use-cases

- get-auth-context
- establish-session (authentificate-account)

- refrest-session
- revoke-session
- rotate-proxy

### db-tables

- proxies
- accounts
- sessions (proxy + account + cookie + browser config + other auth configs)

### event lib

mitt
eventemitter3
emittery
