/**
 * next/link for the phone app (aliased in vite.config.mts): the shared components link to "/dives/…"
 * as on the web, and the phone app routes on the part after the "#".
 */
export default function Link({ href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={`#${href}`} {...rest} />;
}
