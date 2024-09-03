import { cn } from '@/lib/utils.js'
import { Loader2, type LucideIcon } from 'lucide-react'

import { Button, type ButtonProps } from './ui/button.js'

interface ButtonExProps extends ButtonProps {
  disabled?: boolean
  icon?: LucideIcon
  iconSize?: number
  isLoading?: boolean
  label: JSX.Element | string
  loadingLabel?: string
}

export const ExtendedButton = ({ disabled = false, icon: Icon, iconSize, isLoading, label, loadingLabel, ...props }: ButtonExProps) => {
  return (
    <Button
      disabled={disabled || isLoading}
      {...props}
      className={cn('bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-500 disabled:text-white text-medium text-white', props.className)}
    >
      {isLoading
        ? <Loader2 className="animate-spin mr-2" size={iconSize ?? 18} />
        : Icon ? <Icon className="mr-2" size={iconSize ?? 18} /> : null
      }
      {isLoading ? loadingLabel ?? 'Please wait...' : label}
    </Button>)
}
