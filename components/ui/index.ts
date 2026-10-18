/**
 * Punto de entrada único para la biblioteca visual de LedBox.
 *
 * Las pantallas nuevas deben importar controles desde `@/components/ui`.
 * Los módulos existentes pueden migrarse de forma incremental; no se deben
 * crear variantes locales de botones, diálogos o campos si ya existe una pieza
 * equivalente aquí.
 */
export {
  AdminButton,
  AdminButtonLink,
  AdminIconButton,
  AdminIconLink,
  AdminActionsMenu,
  AdminBadge,
  AdminTabs,
  AdminNote,
  AdminEmpty,
  AdminErrorState,
  AdminLoadingRows,
  AdminDataState,
  AdminDisclosure,
  AdminDialog,
  AdminDialogSection,
  AdminCol,
  AdminConfirmDialog,
  AdminTimeline,
  AdminTimelineDialog,
  AdminSelect,
  AdminToolbar,
  AdminKpis,
  AdminKpi,
  AdminPanel,
  AdminTable,
  AdminRow,
  AdminCell,
  AdminSpinner,
  AdminError,
  AdminSuccess,
} from "@/components/admin/AdminUI";

export {
  AdminFieldHelp,
  TextField,
  TextAreaField,
  ColorField,
  MoneyField,
  PercentField,
  NumberField,
  PhoneField,
  CityField,
  BancoField,
  EmailField,
  RucField,
  SerialField,
  DateField,
  TimeField,
  DateTimeField,
  DayField,
  SelectField,
  Combobox,
  SwitchField,
  CheckboxField,
  PasswordField,
  SearchField,
  PinField,
  SegmentedField,
  AttachmentInput,
  FileField,
} from "@/components/admin/AdminFields";

export type {
  AdminButtonVariant,
  AdminButtonSize,
  AdminMenuItem,
  AdminTabItem,
} from "@/components/admin/AdminUI";

export type { FieldSize, TextFieldProps, TextAreaFieldProps, ComboboxOption } from "@/components/admin/AdminFields";

// Presentaciones canónicas de registros. Los módulos aportan los datos y las
// acciones; estas piezas mantienen una sola estructura para lista, cuadrícula
// y pipeline/tablero.
export { AdminViewSwitch, AdminBoard, useAdminModuleView, useAdminNarrowViewport, useAdminBoardMove } from "@/components/admin/AdminBoard";
export { AdminCardGrid } from "@/components/admin/AdminCards";
export type {
  AdminModuleView,
  AdminBoardColumn,
  AdminBoardCardData,
  AdminBoardMoveOutcome,
} from "@/components/admin/AdminBoard";
export type { AdminCardField, AdminCardData } from "@/components/admin/AdminCards";
