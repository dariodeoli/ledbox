import type { ReactNode } from "react";

/** Misma estructura y clases de la landing; sólo cambia el contenido comercial. */
export function LandingHero({ kicker, title, description, actions, foot }: { kicker: ReactNode; title: ReactNode; description: ReactNode; actions: ReactNode; foot?: ReactNode }) {
  return <header id="hero"><div><div className="hero-kicker rise on">{kicker}</div><h1 className="mega rise on">{title}</h1><p className="hero-sub rise on">{description}</p><div className="hero-actions rise on">{actions}</div></div>{foot ? <div className="hero-foot">{foot}</div> : null}</header>;
}
