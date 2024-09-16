import { Card } from '@/components/ui/card';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type Effect = 'fade' | 'none' | 'roman' | 'slide';

interface CardFlowProps {
  children: React.ReactNode;
  columnWidth?: number;
  effect?: Effect;
  gap?: number;
  mobileBreakpoint?: number;
}

export const CardFlow: React.FC<CardFlowProps> = ({
  children,
  columnWidth = 345,
  effect = 'slide',
  gap = 13,
  mobileBreakpoint = 640
}) => {
  const [columns, setColumns] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [animatedItems, setAnimatedItems] = useState<boolean[]>([]);

  const childrenArray = useMemo(
    () => React.Children.toArray(children),
    [children]
  );

  useEffect(() => {
    setAnimatedItems(new Array(childrenArray.length).fill(false));
  }, [childrenArray]);

  useEffect(() => {
    const updateLayout = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const newIsMobile = containerWidth <= mobileBreakpoint;
        setIsMobile(newIsMobile);

        if (newIsMobile) {
          setColumns(1);
        } else {
          const newColumns = Math.max(
            1,
            Math.floor((containerWidth + gap) / (columnWidth + gap))
          );
          setColumns(newColumns);
        }
      }
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, [columnWidth, gap, mobileBreakpoint]);

  useEffect(() => {
    if (containerRef.current) {
      const heights = Array(columns).fill(0);

      itemsRef.current.forEach((item, index) => {
        if (item) {
          if (isMobile) {
            item.style.position = 'static';
            item.style.width = '100%';
            item.style.transform = 'none';
          } else {
            const shortestColumn = heights.indexOf(Math.min(...heights));
            const left = shortestColumn * (columnWidth + gap);
            const top = heights[shortestColumn];

            item.style.position = 'absolute';
            item.style.left = `${left}px`;
            item.style.top = `${top}px`;
            item.style.width = `${columnWidth}px`;

            heights[shortestColumn] += item.offsetHeight + gap;
          }
        }
      });

      if (isMobile) {
        containerRef.current.style.height = 'auto';
      } else {
        const maxHeight = Math.max(...heights);
        containerRef.current.style.height = `${maxHeight}px`;
      }
    }
  }, [columns, isMobile, columnWidth, gap, childrenArray]);

  const getEffectClasses = (effect: Effect, index: number): string => {
    if (animatedItems[index]) return '';

    switch (effect) {
      case 'slide':
        return 'transition-all duration-300 ease-in-out';
      case 'fade':
        return 'transition-opacity duration-300 ease-in-out';
      case 'roman':
        return 'animate-roman-appear';
      case 'none':
      default:
        return '';
    }
  };

  const handleAnimationEnd = (index: number) => {
    setAnimatedItems((prev) => {
      const newAnimatedItems = [...prev];
      newAnimatedItems[index] = true;
      return newAnimatedItems;
    });
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      {React.Children.map(children, (child, index) => (
        <div
          className={`${getEffectClasses(effect, index)} ${isMobile ? 'w-full mb-4' : ''}`}
          key={index}
          onAnimationEnd={() => handleAnimationEnd(index)}
          ref={(el) => (itemsRef.current[index] = el)}
        >
          <Card className="overflow-hidden p-4 border border-transparent hover:border-accent/50 transition-all duration-200 shadow-md hover:shadow-lg bg-gradient-to-b from-background/5 to-background/30 md:min-h-[200px]">
            {child}
          </Card>
        </div>
      ))}
      <style>{`
        @keyframes roman-appear {
          0% {
            opacity: 0;
            transform: rotateX(-10deg) scale(0.95);
          }
          100% {
            opacity: 1;
            transform: rotateX(0) scale(1);
          }
        }
        .animate-roman-appear {
          animation: roman-appear 500ms forwards
            cubic-bezier(0.25, 0.1, 0.25, 1);
        }
      `}</style>
    </div>
  );
};
