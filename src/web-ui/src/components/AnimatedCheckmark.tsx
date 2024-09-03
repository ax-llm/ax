import { cn } from '@/lib/utils'

import './styles/checkmark.css'

const sizeMap: Record<string, string> = {
  large: '52px',
  medium: '24px',
  small: '16px',
  xLarge: '72px',
  xxLarge: '96px'
}

interface CheckmarkProps {
  className?: string
  color?: string
  size?: number | string
}

export const AnimatedCheckmark = ({ className, color, size }: CheckmarkProps) => {
  const computedSize = sizeMap[size ?? 'large'] || size

  const style = {
    height: computedSize,
    width: computedSize,
    ...(color ? { '--checkmark-fill-color': color } : {})
  }

  return (
    <svg
      className={cn('checkmark', className)}
      style={style}
      viewBox='0 0 52 52'
      xmlns='http://www.w3.org/2000/svg'
    >
      <circle className='checkmark__circle' cx='26' cy='26' fill='none' r='25' />
      <path className='checkmark__check' d='M14.1 27.2l7.1 7.2 16.7-16.8' fill='none' />
    </svg >
  )
}
