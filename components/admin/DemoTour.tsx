"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEMO_TOUR_STEPS } from "@/lib/demo-tour";
import { AdminIcon } from "./AdminIcons";

/**
 * Recorrido guiado de la demo (issue #58).
 *
 * Cinco pasos cortos con un botón para ir al módulo: el visitante avanza y
 * vuelve sin perderse, y el paso queda recordado en su navegador (nada más que
 * el paso: la demo no guarda datos del visitante). La portada lo muestra arriba
 * de todo y «Recorrer la demo» del popup de bienvenida lleva acá.
 */
const STORAGE_KEY = "ledbox.demo.tour.v1";

export function DemoTour() {
  const [stepId, setStepId] = useState(DEMO_TOUR_STEPS[0].id);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && DEMO_TOUR_STEPS.some((step) => step.id === stored)) setStepId(stored);
    } catch {
      /* sin almacenamiento el recorrido arranca en el paso 1 */
    }
    setReady(true);
  }, []);

  const index = Math.max(0, DEMO_TOUR_STEPS.findIndex((step) => step.id === stepId));
  const step = DEMO_TOUR_STEPS[index] ?? DEMO_TOUR_STEPS[0];
  const last = index === DEMO_TOUR_STEPS.length - 1;

  function go(next: number) {
    const target = DEMO_TOUR_STEPS[next];
    if (!target) return;
    setStepId(target.id);
    try {
      window.localStorage.setItem(STORAGE_KEY, target.id);
    } catch {
      /* la posición del recorrido vale solo para esta pantalla */
    }
  }

  return (
    <section className="admin-demo-tour" aria-label="Recorrido guiado de la demo" data-ready={ready}>
      <header className="admin-demo-tour-head">
        <span className="admin-panel-icon" aria-hidden="true">
          <AdminIcon name="overview" size={13} />
        </span>
        <h2 className="admin-panel-title">Recorrido guiado</h2>
        <span className="admin-panel-meta">
          Paso {index + 1} de {DEMO_TOUR_STEPS.length}
        </span>
      </header>

      <ol className="admin-demo-tour-steps">
        {DEMO_TOUR_STEPS.map((option, position) => (
          <li key={option.id}>
            <button
              type="button"
              className="admin-demo-tour-step"
              aria-current={position === index ? "step" : undefined}
              onClick={() => go(position)}
              title={`Ir al paso ${position + 1}: ${option.title}`}
            >
              <span className="admin-demo-tour-num">{position + 1}</span>
              <span>{option.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="admin-demo-tour-body">
        <p className="admin-demo-tour-what">{step.what}</p>
        <div className="admin-demo-actions admin-demo-actions--inline">
          <Link className="admin-btn admin-btn--primary" href={step.href}>
            <AdminIcon name="arrow-right" size={15} />
            <span>{step.title}</span>
          </Link>
          <button
            type="button"
            className="admin-btn"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            title="Paso anterior del recorrido"
          >
            <AdminIcon name="arrow-left" size={15} />
            <span>Anterior</span>
          </button>
          {last ? (
            <button type="button" className="admin-btn" onClick={() => go(0)} title="Volver al primer paso del recorrido">
              <AdminIcon name="refresh" size={15} />
              <span>Volver al inicio</span>
            </button>
          ) : (
            <button
              type="button"
              className="admin-btn"
              onClick={() => go(index + 1)}
              title="Paso siguiente del recorrido"
            >
              <AdminIcon name="arrow-right" size={15} />
              <span>Siguiente</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
