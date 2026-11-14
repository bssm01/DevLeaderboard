import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class-name joiner: `clsx` for conditionals, `tailwind-merge` so later
 * utilities win (e.g. `cn("p-4", "p-2")` → `p-2`, no specificity fights).
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
