import { useRef, useEffect, useCallback } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  phase: number;
  speed: number;
}

// Ax subsystem colors (matching FeatureGrid)
const SUBSYSTEM_COLORS = [
  'rgba(167, 139, 250, 0.8)', // violet — AxGen
  'rgba(34, 211, 238, 0.8)', // cyan — AxAI
  'rgba(52, 211, 153, 0.8)', // emerald — AxAgent
  'rgba(251, 191, 36, 0.8)', // amber — AxFlow
  'rgba(244, 114, 182, 0.8)', // pink — AxLearn
  'rgba(45, 212, 191, 0.8)', // teal — AxSignature
  'rgba(99, 102, 241, 0.8)', // indigo — AxRAG
  'rgba(250, 204, 21, 0.8)', // yellow — DSPy
];

const SUBSYSTEM_COLORS_LIGHT = [
  'rgba(139, 92, 246, 0.6)',
  'rgba(6, 182, 212, 0.6)',
  'rgba(16, 185, 129, 0.6)',
  'rgba(245, 158, 11, 0.6)',
  'rgba(236, 72, 153, 0.6)',
  'rgba(20, 184, 166, 0.6)',
  'rgba(79, 70, 229, 0.6)',
  'rgba(234, 179, 8, 0.6)',
];

const CONNECTION_RADIUS = 150;
const MOUSE_RADIUS = 200;
const NODE_COUNT = 50;

function createNodes(w: number, h: number): Node[] {
  const nodes: Node[] = [];

  // 8 larger subsystem nodes
  for (let i = 0; i < 8; i++) {
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radius: 4 + Math.random() * 2,
      color: SUBSYSTEM_COLORS[i],
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.4,
    });
  }

  // Smaller ambient particles
  for (let i = 8; i < NODE_COUNT; i++) {
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      radius: 1.5 + Math.random() * 1.5,
      color: 'rgba(148, 163, 184, 0.4)',
      phase: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random() * 0.3,
    });
  }

  return nodes;
}

export default function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);
  const timeRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visibleRef.current) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const isDark = document.documentElement.classList.contains('dark');
    const nodes = nodesRef.current;
    const mouse = mouseRef.current;

    timeRef.current += 0.016;
    const t = timeRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Update node positions
    for (const node of nodes) {
      // Brownian drift
      node.x += node.vx;
      node.y += node.vy + Math.sin(t * node.speed + node.phase) * 0.3;

      // Mouse attraction (gentle spring)
      const dx = mouse.x - node.x;
      const dy = mouse.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * 0.02;
        node.vx += dx * force;
        node.vy += dy * force;
      }

      // Damping
      node.vx *= 0.98;
      node.vy *= 0.98;

      // Wrap around edges
      if (node.x < -20) node.x = w + 20;
      if (node.x > w + 20) node.x = -20;
      if (node.y < -20) node.y = h + 20;
      if (node.y > h + 20) node.y = -20;
    }

    // Draw edges
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_RADIUS) {
          const opacity =
            (1 - dist / CONNECTION_RADIUS) * (isDark ? 0.12 : 0.08);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = isDark
            ? `rgba(255, 255, 255, ${opacity})`
            : `rgba(100, 116, 139, ${opacity})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isSubsystem = i < 8;

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

      if (isSubsystem) {
        ctx.fillStyle = isDark
          ? SUBSYSTEM_COLORS[i]
          : SUBSYSTEM_COLORS_LIGHT[i];

        // Glow for subsystem nodes
        if (isDark) {
          ctx.shadowColor = SUBSYSTEM_COLORS[i];
          ctx.shadowBlur = 12;
        }
      } else {
        ctx.fillStyle = isDark
          ? 'rgba(148, 163, 184, 0.3)'
          : 'rgba(148, 163, 184, 0.25)';
        ctx.shadowBlur = 0;
      }

      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      // Re-create nodes if dimensions changed significantly
      if (nodesRef.current.length === 0) {
        nodesRef.current = createNodes(w, h);
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement!);
    resize();

    // Intersection observer to pause when off-screen
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(canvas);

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    if (prefersReducedMotion) {
      // Draw once for static snapshot
      nodesRef.current = createNodes(
        canvas.width / (window.devicePixelRatio || 1),
        canvas.height / (window.devicePixelRatio || 1)
      );
      // Draw a single frame
      visibleRef.current = true;
      const drawOnce = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const isDark = document.documentElement.classList.contains('dark');
        const nodes = nodesRef.current;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);

        // Draw edges
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < CONNECTION_RADIUS) {
              const opacity =
                (1 - dist / CONNECTION_RADIUS) * (isDark ? 0.12 : 0.08);
              ctx.beginPath();
              ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y);
              ctx.strokeStyle = isDark
                ? `rgba(255, 255, 255, ${opacity})`
                : `rgba(100, 116, 139, ${opacity})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }

        // Draw nodes
        for (let i = 0; i < nodes.length; i++) {
          ctx.beginPath();
          ctx.arc(nodes[i].x, nodes[i].y, nodes[i].radius, 0, Math.PI * 2);
          if (i < 8) {
            ctx.fillStyle = isDark
              ? SUBSYSTEM_COLORS[i]
              : SUBSYSTEM_COLORS_LIGHT[i];
          } else {
            ctx.fillStyle = isDark
              ? 'rgba(148, 163, 184, 0.3)'
              : 'rgba(148, 163, 184, 0.25)';
          }
          ctx.fill();
        }

        ctx.restore();
      };
      drawOnce();
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [draw]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}
