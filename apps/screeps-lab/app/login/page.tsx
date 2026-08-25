import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sendMagicLink } from "./actions";

export const dynamic = "force-dynamic";

const errorMessage = (error?: string) => {
  if (error === "rate-limit") return "Too many magic-link requests. Supabase is temporarily rate-limiting email sends. Try again shortly.";
  if (error === "invalid-email") return "Enter a valid email address.";
  if (error === "callback") return "The sign-in link could not be completed. Request a fresh magic link and try again.";
  if (error) return "Sign-in could not be started. Check the address and try again.";
  return null;
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const message = errorMessage(params.error);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Operator sign in</CardTitle>
          <CardDescription>
            Authenticate with Supabase. Command authority is granted separately through the operator allowlist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.sent === "1" ? (
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              Magic link sent. Open it from this browser to continue.
            </div>
          ) : (
            <form action={sendMagicLink} className="grid gap-4">
              <div className="grid gap-2">
                <label htmlFor="email" className="text-sm font-medium leading-none">Email</label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {message ? <p className="text-sm text-red-300">{message}</p> : null}
              <Button type="submit">Send magic link</Button>
            </form>
          )}
          <a href="/" className="mt-5 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline">
            Return to observability
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
