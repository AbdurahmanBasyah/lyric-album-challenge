"use client";

type GlobalErrorProps = {
    error: Error & { digest?: string };
    reset?: () => void;
    retry?: () => void;
};

export default function GlobalError({ reset, retry }: GlobalErrorProps) {
    const recover = retry ?? reset;

    const handleRecovery = () => {
        if (recover) {
            recover();
            return;
        }

        window.location.reload();
    };

    return (
        <html lang="en">
            <head>
                <title>Something went wrong | FillTheLyrics</title>
            </head>
            <body className="bg-[#11141b] text-[#f4f5f7]">
                <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_85%,rgba(194,76,255,0.16),transparent_30rem),radial-gradient(circle_at_85%_5%,rgba(108,242,178,0.13),transparent_30rem)]" aria-hidden="true" />
                    <div className="relative z-[1] w-full max-w-[1344px]">
                        <section className="mx-auto w-full max-w-md space-y-6 rounded-[22px] border border-white/15 bg-[rgba(38,42,52,0.72)] p-7 text-center shadow-[0_1.25rem_3.75rem_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-9">
                        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#7cf5bc]">
                            FillTheLyrics
                        </p>
                        <h1 className="text-3xl font-semibold tracking-tight">
                            The app needs a quick reset.
                        </h1>
                        <p className="text-base leading-7 text-[#b8bdc7]">
                            Something interrupted the page. Try again and
                            we&apos;ll help you get back on track.
                        </p>
                        <button
                            type="button"
                            onClick={handleRecovery}
                            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#7cf5bc] px-6 py-3 text-sm font-semibold text-[#23005c] transition-colors hover:brightness-105"
                        >
                            Try again
                        </button>
                        </section>
                    </div>
                </main>
            </body>
        </html>
    );
}
