import { cn } from '@/lib/utils';
import { VariantProps, cva } from 'class-variance-authority';
import React from 'react';

const titleVariants = cva('font-medium text-primary', {
  defaultVariants: {
    align: 'left',
    size: 'default'
  },
  variants: {
    align: {
      center: 'text-center',
      left: 'text-left',
      right: 'text-right'
    },
    size: {
      '2xl': 'text-5xl md:text-6xl',
      default: 'text-3xl md:text-4xl',
      md: 'text-2xl md:text-3xl',
      sm: 'text-xl md:text-2xl',
      xl: 'text-4xl md:text-5xl',
      xs: 'text-lg md:text-xl'
    }
  }
});

export interface TitleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof titleVariants> {
  children: React.ReactNode;
  subtitle?: string;
}

const Title: React.FC<TitleProps> = ({
  align,
  children,
  className,
  size,
  subtitle,
  ...props
}) => {
  return (
    <div className={cn('mb-6', className)} {...props}>
      <h1 className={cn(titleVariants({ align, size }))}>{children}</h1>
      {subtitle && (
        <p className="mt-2 text-xl text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
};

export default Title;
