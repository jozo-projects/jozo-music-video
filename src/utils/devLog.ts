const IS_DEV = import.meta.env.DEV;

/** Chỉ log khi development — tránh spam console trên prod. */
export const devLog = (...args: unknown[]) => {
  if (IS_DEV) console.log(...args);
};

export const devError = (...args: unknown[]) => {
  if (IS_DEV) console.error(...args);
};

export { IS_DEV };
