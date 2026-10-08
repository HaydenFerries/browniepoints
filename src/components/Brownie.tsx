import brownie96 from '../assets/generated/brownie-96.webp';
import brownie256 from '../assets/generated/brownie-256.webp';
import { plural } from '../lib/util';

export const BROWNIE_SMALL = brownie96;
export const BROWNIE_LARGE = brownie256;

/** The brownie "currency" icon (a real photo, cut out). */
export function BrownieIcon({ size = '1.25em', className = '' }: { size?: number | string; className?: string }) {
  return (
    <img
      src={typeof size === 'number' && size > 64 ? brownie256 : brownie96}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`brownie-icon ${className}`}
      style={{ width: size, height: 'auto' }}
    />
  );
}

/** A brownie amount, e.g. [brownie] 25. */
export function Amount({
  n,
  sign = false,
  size = 'md',
  className = '',
}: {
  n: number;
  sign?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const text = sign && n > 0 ? `+${n}` : sign && n < 0 ? `−${Math.abs(n)}` : String(n);
  return (
    <span className={`amount amount-${size} ${className}`} title={plural(n)}>
      <BrownieIcon />
      <span className="amount-n" aria-hidden="true">
        {text}
      </span>
      <span className="sr-only">{sign && n > 0 ? `plus ${plural(n)}` : sign && n < 0 ? `minus ${plural(-n)}` : plural(n)}</span>
    </span>
  );
}
