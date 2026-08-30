"use client";

type RouteErrorProps = {
    error: Error & { digest?: string };
    reset: () => void;
    retry?: () => void;
};

export default function Error({ reset, retry }: RouteErrorProps) {
    const recover = retry ?? reset;

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--background)] px-6 py-16 text-[var(--foreground)]">
            <div className="ambient-shader" aria-hidden="true" />
            <div className="relative z-[1] w-full max-w-[var(--layout-shell-max)]">
                <section className="glass-panel mx-auto w-full max-w-md space-y-6 rounded-[var(--radius-xl)] p-7 text-center sm:p-9">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--teal)]">
                    FillTheLyrics
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Something went wrong.
                </h1>
                <p className="text-base leading-7 text-[var(--muted-strong)]">
                    We hit a small snag. Try again and we&apos;ll get you back
                    to the challenge.
                </p>
                <button
                    type="button"
                    onClick={recover}
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--teal)] px-6 py-3 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:brightness-105"
                >
                    Try again
                </button>
                </section>
            </div>
        </main>
    );
}
