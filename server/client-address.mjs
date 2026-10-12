import { BlockList, isIP, SocketAddress } from 'node:net';

export function clientAddressResolver(addresses) {
  const trusted = new BlockList();
  for (const address of addresses) {
    const version = isIP(address);
    if (!version) throw new Error('TRUSTED_PROXY_ADDRESSES must contain IP addresses');
    trusted.addAddress(address, version === 4 ? 'ipv4' : 'ipv6');
  }
  return request => {
    let address = request.socket.remoteAddress;
    const version = isIP(address);
    if (version && trusted.check(address, version === 4 ? 'ipv4' : 'ipv6')) {
      address = request.headers['x-real-ip'];
      if (typeof address !== 'string' || !isIP(address)) throw new Error('Trusted proxy must supply one valid X-Real-IP');
    }
    const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
    return new SocketAddress({ address, family }).address;
  };
}
