import type React from 'react';
import { useRef, useState } from 'react';
import { motion } from 'framer-motion';

interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  delay?: number;
  href?: string;
  external?: boolean;
}

const cardVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      delay,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

export function GlowCard({
  children,
  className = '',
  glowColor = 'rgba(99, 102, 241, 0.15)',
  delay = 0,
  href,
  external = false,
}: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePosition({ x, y });
  };

  const inner = (
    <>
      {/* Mouse-tracking glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-30 dark:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `radial-gradient(400px circle at ${mousePosition.x}% ${mousePosition.y}%, ${glowColor}, transparent 40%)`,
        }}
      />
      {/* Content */}
      <div className="relative z-10 h-full">{children}</div>
      {/* Border glow on hover */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-0 dark:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          padding: '1px',
          background: `linear-gradient(135deg, ${glowColor.replace(/[\d.]+\)$/, '0.4)')}, transparent 50%)`,
          WebkitMask:
            'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />
    </>
  );

  const baseClasses = `
    group relative overflow-hidden rounded-2xl
    bg-white border border-gray-200 shadow-sm
    hover:shadow-md hover:border-gray-300
    dark:bg-none dark:bg-white/[0.05]
    dark:border-white/10 dark:shadow-none dark:backdrop-blur-sm
    dark:hover:border-white/20 dark:hover:shadow-none
    transition-all duration-300
    ${className}
  `;

  if (href) {
    return (
      <motion.a
        ref={cardRef as React.Ref<HTMLAnchorElement>}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        custom={delay}
        variants={cardVariants}
        whileHover={{ y: -4, transition: { duration: 0.2 } }}
        onMouseMove={
          handleMouseMove as unknown as React.MouseEventHandler<HTMLAnchorElement>
        }
        className={baseClasses}
      >
        {inner}
      </motion.a>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      custom={delay}
      variants={cardVariants}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      onMouseMove={handleMouseMove}
      className={baseClasses}
    >
      {inner}
    </motion.div>
  );
}
