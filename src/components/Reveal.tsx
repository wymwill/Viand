"use client";

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

type RevealProps = ComponentPropsWithoutRef<"div"> & {
  /** Milliseconds to hold before this block eases in, for staggered groups. */
  delay?: number;
};

/**
 * Fades and lifts a block into place the first time it enters the viewport.
 * Reveals immediately when IntersectionObserver is unavailable so content
 * never gets stranded at opacity 0.
 */
export default function Reveal({
  delay = 0,
  className = "",
  style,
  children,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal${visible ? " is-visible" : ""}${className ? ` ${className}` : ""}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
