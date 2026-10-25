import { z } from "zod";
import { GEAR_KINDS, type KitChange, WATERS } from "./kit";

/** Checks a kit change from the app or the agent; the ranges are checked by updateKit. */
const num = z.number().nullable().optional();
const text = z.string().max(200).nullable().optional();
const water = z.enum(WATERS as [string, ...string[]]);

export const kitChangeSchema = z.object({
  diver: z.object({ massKg: num, heightCm: num, bodyFatPercent: num }).optional(),
  items: z
    .array(
      z.object({
        id: z.string().max(60).optional(),
        name: z.string().max(100).optional(),
        kind: z.enum(GEAR_KINDS as [string, ...string[]]).optional(),
        brand: text,
        notes: z.string().max(1000).nullable().optional(),
        buoyancyKg: num,
        suitType: z.enum(["wetsuit", "semidry", "drysuit"]).nullable().optional(),
        thicknessMm: num,
        undergarment: text,
        size: z.string().max(20).nullable().optional(),
        ageYears: num,
        material: z.enum(["steel", "aluminium", "carbon"]).nullable().optional(),
        volumeL: num,
        workingPressureBar: num,
        emptyBuoyancyKg: num,
        plate: z.enum(["steel", "aluminium", "none"]).nullable().optional(),
      }),
    )
    .max(100)
    .optional(),
  sets: z
    .array(
      z.object({
        id: z.string().max(60).optional(),
        name: z.string().max(100).optional(),
        items: z.array(z.string().max(100)).max(50).optional(),
        ballastKg: num,
        water: water.nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  sites: z
    .array(z.object({ name: z.string().max(200), water: water.nullable(), density: num }))
    .max(200)
    .optional(),
  remove: z.object({ items: z.array(z.string().max(100)).optional(), sets: z.array(z.string().max(100)).optional() }).optional(),
});

export const parseKitChange = (body: unknown): KitChange => kitChangeSchema.parse(body) as KitChange;
