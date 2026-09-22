/**
 * Declaraciones del piloto para `owncoding-ui` (v0.12.0).
 *
 * La librería se publica como JS sin tipos (`dist/index.js`, sin `.d.ts`) y
 * `tsconfig` tiene `allowJs: false` + `strict`, así que importarla directo falla
 * con TS7016. Este shim declara lo que usa el piloto; **no** es la API completa.
 *
 * Pendiente para adopción real: la librería debería publicar `dist/index.d.ts`
 * (o `types` en package.json) generado de su JSDoc, y exportar los tipos de las
 * props de cada objeto.
 */
declare module "owncoding-ui" {
  import type { ReactNode } from "react";

  // ── Acciones y superficies ────────────────────────────────────────────────
  type Variante = "primary" | "success" | "danger" | "outline" | "ghost";
  interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variante;
  }
  function Button(props: ButtonProps): ReactNode;

  interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}
  function Card(props: CardProps): ReactNode;

  // ── Campos ────────────────────────────────────────────────────────────────
  interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
  function Input(props: InputProps): ReactNode;

  interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
    currency?: string;
    symbol?: string;
    value: number | string;
    onValueChange?: (value: number | string) => void;
    max?: number;
  }
  function MoneyInput(props: MoneyInputProps): ReactNode;

  interface MoneyProps {
    value: number | string;
    currency?: string;
    className?: string;
  }
  function Money(props: MoneyProps): ReactNode;

  interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}
  function Select(props: SelectProps): ReactNode;

  interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}
  function Label(props: LabelProps): ReactNode;

  interface FormFieldProps {
    label?: string;
    hint?: string;
    error?: string | null;
    children: ReactNode;
    htmlFor?: string;
  }
  function FormField(props: FormFieldProps): ReactNode;

  interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange" | "type"> {
    checked: boolean;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    ariaLabel?: string;
  }
  function Switch(props: SwitchProps): ReactNode;

  interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onClear"> {
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    onClear?: () => void;
    ariaLabel?: string;
  }
  function SearchField(props: SearchFieldProps): ReactNode;

  // ── Estados y avisos ──────────────────────────────────────────────────────
  interface EmptyStateProps {
    icon?: string;
    title?: string;
    description?: string;
    action?: ReactNode;
    compact?: boolean;
    className?: string;
  }
  function EmptyState(props: EmptyStateProps): ReactNode;

  interface ErrorStateProps {
    title?: string;
    description?: string;
    onRetry?: () => void;
  }
  function ErrorState(props: ErrorStateProps): ReactNode;

  type AvisoTono = "error" | "ok" | "warn";
  interface AvisoProps extends React.HTMLAttributes<HTMLElement> {
    tono?: AvisoTono;
    como?: "p" | "div";
    compact?: boolean;
    children?: ReactNode;
  }
  function Aviso(props: AvisoProps): ReactNode;

  type NotaTono = "warn" | "info" | "neutro";
  interface NotaProps extends React.HTMLAttributes<HTMLElement> {
    tono?: NotaTono;
    como?: "p" | "div";
    compact?: boolean;
    children?: ReactNode;
  }
  function Nota(props: NotaProps): ReactNode;

  interface SkeletonProps {
    className?: string;
  }
  function Skeleton(props: SkeletonProps): ReactNode;

  // ── Diálogos ──────────────────────────────────────────────────────────────
  type TamanoModal = "corto" | "formulario" | "amplio" | "completo";
  interface ModalProps {
    open: boolean;
    onClose?: () => void;
    title: string;
    children: ReactNode;
    className?: string;
    size?: TamanoModal;
  }
  function Modal(props: ModalProps): ReactNode;

  // ── Datos y tablas ────────────────────────────────────────────────────────
  interface DataTableColumna<Row> {
    key: string;
    label: string;
    align?: "left" | "right" | "center";
    render?: (row: Row) => ReactNode;
  }
  interface DataTableProps<Row> {
    columns: Array<DataTableColumna<Row>>;
    rows: Row[];
    emptyLabel?: string;
    loading?: boolean;
    mobileCard?: (row: Row) => ReactNode;
    className?: string;
  }
  function DataTable<Row>(props: DataTableProps<Row>): ReactNode;

  interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    color?: "blue" | "green" | "red" | "orange" | "yellow" | "slate";
  }
  function Badge(props: BadgeProps): ReactNode;

  type EstadoEquipo = "pass" | "revision" | "pendiente" | "falla";
  interface ChipEstadoProps {
    estado?: EstadoEquipo;
    etiqueta?: string;
    icono?: string;
    className?: string;
  }
  function ChipEstado(props: ChipEstadoProps): ReactNode;

  interface CeldaMonedaProps {
    valor: number | string;
    tono?: string;
    currency?: string;
    className?: string;
    children?: ReactNode;
  }
  function CeldaMoneda(props: CeldaMonedaProps): ReactNode;

  interface StatProps {
    label: string;
    valor: ReactNode;
    delta?: number;
    sub?: string;
    destacado?: boolean;
    className?: string;
  }
  function Stat(props: StatProps): ReactNode;

  interface SubtabsProps {
    value: string;
    onChange: (value: string) => void;
    items?: Array<[string, string]>;
    className?: string;
  }
  function Subtabs(props: SubtabsProps): ReactNode;

  interface IconActionProps {
    icon: string;
    label: string;
    tone?: "ok" | "warn" | "fono" | "bad" | "mute";
    onClick?: () => void;
    disabled?: boolean;
  }
  function IconAction(props: IconActionProps): ReactNode;

  // ── Constantes y formatos ─────────────────────────────────────────────────
  const CELDA_DATO: string;
  const CELDA_ENCABEZADO: string;
  const CELDA_NUMERO: string;
  const CELDA_IDENTIDAD: string;
  const ROTULO_DATO: string;
  const ROTULO_SECCION: string;
  const TAMANOS_CAMPO: Record<string, string>;
  const ESTADOS_CHIP: Record<string, { etiqueta: string; tono: string; icono: string }>;

  function formatGs(value: number | string): string;
  function montoGs(value: number | string | null | undefined, vacio?: string): string;
  function montoUsd(value: number | string | null | undefined, vacio?: string): string;
  function montoTexto(value: number | string | null | undefined, currency?: string, vacio?: string): string;
  function fechaDia(value: string | Date | null | undefined): string;
  function fechaHora(value: string | Date | null | undefined): string;
  function fechaCorta(value: string | Date | null | undefined): string;
  function cn(...values: unknown[]): string;
}
