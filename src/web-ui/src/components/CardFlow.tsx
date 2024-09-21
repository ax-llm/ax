import { Card } from '@/components/ui/card';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface CardData {
  content: React.ReactNode;
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

interface CardFlowProps {
  cardWidth?: number;
  children: React.ReactNode[];
  gap?: number;
  mobileBreakpoint?: number;
}

export const CardFlow: React.FC<CardFlowProps> = ({
  cardWidth = 345,
  children,
  gap = 13,
  mobileBreakpoint = 640
}) => {
  const [cards, setCards] = useState<CardData[]>([]);
  const [columns, setColumns] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const calculateLayout = useCallback(() => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.offsetWidth;
    const newIsMobile = containerWidth <= mobileBreakpoint;
    setIsMobile(newIsMobile);

    const newColumns = newIsMobile
      ? 1
      : Math.max(1, Math.floor((containerWidth + gap) / (cardWidth + gap)));
    setColumns(newColumns);

    const columnHeights = new Array(newColumns).fill(0);
    const newCards: CardData[] = children.map((child, index) => {
      const columnIndex = index % newColumns;
      const x = newIsMobile ? 0 : columnIndex * (cardWidth + gap);
      const y = columnHeights[columnIndex];
      const width = newIsMobile ? containerWidth : cardWidth;

      // Get the actual height of the card
      const cardElement = cardRefs.current[index];
      const height = cardElement ? cardElement.offsetHeight : 0;

      columnHeights[columnIndex] += height + gap;

      return {
        content: child,
        height,
        id: index.toString(),
        width,
        x,
        y
      };
    });

    setCards(newCards);

    if (containerRef.current) {
      containerRef.current.style.height = `${Math.max(...columnHeights)}px`;
    }
  }, [children, cardWidth, gap, mobileBreakpoint]);

  useEffect(() => {
    const observeCardHeights = () => {
      cardRefs.current.forEach((cardRef, index) => {
        if (cardRef) {
          const resizeObserver = new ResizeObserver(() => {
            calculateLayout();
          });
          resizeObserver.observe(cardRef);
        }
      });
    };

    calculateLayout();
    observeCardHeights();

    resizeObserverRef.current = new ResizeObserver(calculateLayout);
    if (containerRef.current) {
      resizeObserverRef.current.observe(containerRef.current);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      cardRefs.current.forEach((cardRef) => {
        if (cardRef) {
          resizeObserverRef.current?.unobserve(cardRef);
        }
      });
    };
  }, [calculateLayout]);

  return (
    <div className="relative w-full" ref={containerRef}>
      {children.map((child, index) => (
        <div
          key={index}
          ref={(el) => (cardRefs.current[index] = el)}
          style={{
            left: cards[index]?.x ?? 0,
            position: 'absolute',
            top: cards[index]?.y ?? 0,
            transform: `translate3d(0, 0, 0)`, // For better performance
            transition: 'all 0.3s ease-in-out',
            width: cards[index]?.width ?? cardWidth
          }}
        >
          <Card className="overflow-hidden p-4 border border-transparent hover:border-accent/50 transition-all duration-200 shadow-md hover:shadow-lg bg-gradient-to-b from-background/5 to-background/30">
            {child}
          </Card>
        </div>
      ))}
    </div>
  );
};
