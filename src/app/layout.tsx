import type { Metadata } from "next";
import {
    Bebas_Neue,
    Instrument_Sans,
    Kalam,
} from "next/font/google";
import { MotionProvider } from "@/components/ui/motion-provider";
import "./globals.css";

const displayFont = Bebas_Neue({
    variable: "--font-ftl-display",
    subsets: ["latin"],
    weight: "400",
});

const uiFont = Instrument_Sans({
    variable: "--font-ftl-ui",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

const handwritingFont = Kalam({
    variable: "--font-ftl-handwriting",
    subsets: ["latin"],
    weight: "400",
});

export const metadata: Metadata = {
    title: "FillTheLyrics",
    description: "Rebuild lyric fragments from the albums you know by heart.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
    return (
        <html
            lang="en"
            className={`${displayFont.variable} ${uiFont.variable} ${handwritingFont.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col bg-background font-sans text-foreground">
                <MotionProvider>{children}</MotionProvider>
            </body>
        </html>
    );
}
