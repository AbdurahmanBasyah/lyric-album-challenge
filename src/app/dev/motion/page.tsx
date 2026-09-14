import { notFound } from "next/navigation";

import { MotionLab } from "../../../components/challenge/motion-lab";

/**
 * The lab is intentionally development-only. Keeping the guard in the route
 * itself means production renders a normal not-found response even if the
 * page is requested directly rather than discovered through navigation.
 */
export default function MotionLabPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <MotionLab />;
}
