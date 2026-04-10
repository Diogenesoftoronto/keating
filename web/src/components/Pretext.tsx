import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { useLayoutEffect, useRef, useState, useMemo, useEffect } from 'react';

interface PretextProps {
  text: string;
  font?: string;
  lineHeight?: number;
  className?: string;
  justify?: boolean;
}

export function Pretext({ 
  text, 
  font = '16px "Inter", sans-serif', 
  lineHeight = 24, 
  className = "",
  justify = true
}: PretextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Sync with container width
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateWidth = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerRef.current);
    
    return () => observer.disconnect();
  }, []);

  const prepared = useMemo(() => prepareWithSegments(text, font), [text, font]);
  
  const { lines } = useMemo(() => {
    if (width <= 0 || !text.trim()) return { lines: [] };
    try {
      return layoutWithLines(prepared, width, lineHeight);
    } catch (e) {
      console.error('Pretext layout error:', e);
      return { lines: [] };
    }
  }, [prepared, width, lineHeight, text]);

  if (!text.trim() || lines.length === 0) {
    return <div ref={containerRef} className={className}>{text}</div>;
  }

  return (
    <div 
      ref={containerRef} 
      className={`pretext-container ${className}`}
      style={{ font, lineHeight: `${lineHeight}px` }}
    >
      {lines.map((line, i) => {
        const isLastLine = i === lines.length - 1;
        const shouldJustify = justify && !isLastLine && lines.length > 1;

        return (
          <div 
            key={i} 
            className="pretext-line"
            style={{ 
              height: lineHeight,
              textAlign: shouldJustify ? 'justify' : 'left',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              position: 'relative'
            }}
          >
            {line.text}
            {shouldJustify && (
              <span style={{ display: 'inline-block', width: '100%' }} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
