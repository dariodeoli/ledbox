-- Status-only confirmation. This does not create coverage, reservation, stock or payment effects.
ALTER TYPE "EventExternalNeedStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
