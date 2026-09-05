import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { AuthedShell } from "@/components/AuthedShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearLocalUserData } from "@/lib/chat-cache";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — Manipuri AI" }, { name: "description", content: "Manage your Manipuri AI profile, preferred language and script, voice settings and account details." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ProfilePage,
});

/*
 * Bounds for the personalization fields.
 *
 * These values are read straight into the system prompt on every message, so an
 * unbounded paste here would quietly tax every request the user ever sends. The
 * caps are generous for real use and the API already truncates further when it
 * builds the prompt; this just keeps the stored row sane.
 */
const MAX_SHORT = 80;
const MAX_LIST_ITEMS = 12;
const MAX_ITEM = 60;
const MAX_NOTES = 8;
const MAX_NOTE = 200;

type MemoryRow = {
  name: string | null;
  language: string | null;
  occupation: string | null;
  interests: string[] | null;
  favorite_topics: string[] | null;
  notes: string[] | null;
  updated_at?: string;
};

const listToText = (a: string[] | null | undefined) => (a ?? []).join(", ");
const textToList = (s: string) =>
  s
    .split(",")
    .map((v) => v.trim().slice(0, MAX_ITEM))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);

function ProfilePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").maybeSingle();
      return data;
    },
  });

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    if (profileQ.data) {
      setFullName(profileQ.data.full_name ?? "");
      setUsername(profileQ.data.username ?? "");
      setNewEmail(profileQ.data.email ?? "");
    }
  }, [profileQ.data]);

  /* ===================== What Manipuri AI remembers =====================
   *
   * The assistant already writes to `user_memory` through its memory tool, and
   * everything in that row is injected into the system prompt on every message —
   * but until now the user could neither see it nor change it. That is the part
   * that matters: a personalization store the person it describes can't read is a
   * privacy problem, not a feature.
   *
   * No migration needed. The table's own policy ("Users manage own memory", FOR
   * ALL, `auth.uid() = user_id`) already permits exactly this, and the row is
   * filtered by user id explicitly so an admin account — which has a broader
   * SELECT policy — reads its own row rather than erroring on multiple matches.
   */
  const memoryQ = useQuery({
    queryKey: ["user-memory"],
    queryFn: async (): Promise<{ userId: string; memory: MemoryRow | null }> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? "";
      if (!userId) return { userId: "", memory: null };
      const { data, error } = await supabase
        .from("user_memory")
        .select("name, language, occupation, interests, favorite_topics, notes, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return { userId, memory: (data ?? null) as MemoryRow | null };
    },
    refetchOnWindowFocus: false,
  });

  const [memName, setMemName] = useState("");
  const [memLanguage, setMemLanguage] = useState("");
  const [memOccupation, setMemOccupation] = useState("");
  const [memInterests, setMemInterests] = useState("");
  const [memTopics, setMemTopics] = useState("");
  const [memNotes, setMemNotes] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  // Hydrate once. A plain `if (data)` effect would overwrite whatever the user is
  // in the middle of typing the next time this query refetched.
  const memoryHydrated = useRef(false);

  useEffect(() => {
    if (memoryHydrated.current || !memoryQ.data) return;
    memoryHydrated.current = true;
    const m = memoryQ.data.memory;
    setMemName(m?.name ?? "");
    setMemLanguage(m?.language ?? "");
    setMemOccupation(m?.occupation ?? "");
    setMemInterests(listToText(m?.interests));
    setMemTopics(listToText(m?.favorite_topics));
    setMemNotes((m?.notes ?? []).join("\n"));
  }, [memoryQ.data]);

  const saveMemory = async () => {
    const userId = memoryQ.data?.userId;
    if (!userId || savingMemory) return;
    setSavingMemory(true);
    const notes = memNotes
      .split("\n")
      .map((v) => v.trim().slice(0, MAX_NOTE))
      .filter(Boolean)
      .slice(0, MAX_NOTES);
    const { error } = await supabase.from("user_memory").upsert(
      {
        user_id: userId,
        name: memName.trim().slice(0, MAX_SHORT) || null,
        language: memLanguage.trim().slice(0, MAX_SHORT) || null,
        occupation: memOccupation.trim().slice(0, MAX_SHORT) || null,
        interests: textToList(memInterests),
        favorite_topics: textToList(memTopics),
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    setSavingMemory(false);
    if (error) return toast.error(error.message);
    toast.success("Saved. Manipuri AI will use this from your next message.");
    qc.invalidateQueries({ queryKey: ["user-memory"] });
  };

  const forgetEverything = async () => {
    const userId = memoryQ.data?.userId;
    if (!userId) return;
    if (!confirm("Erase everything Manipuri AI remembers about you? Your chats are kept.")) return;
    const { error } = await supabase.from("user_memory").delete().eq("user_id", userId);
    if (error) return toast.error(error.message);
    setMemName("");
    setMemLanguage("");
    setMemOccupation("");
    setMemInterests("");
    setMemTopics("");
    setMemNotes("");
    toast.success("Memory erased");
    qc.invalidateQueries({ queryKey: ["user-memory"] });
  };

  const saveProfile = async () => {
    const { error } = await supabase.from("profiles").update({ full_name: fullName, username }).eq("id", profileQ.data!.id);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const changePassword = async () => {
    if (newPassword.length < 6) return toast.error("Password must be at least 6 characters");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return toast.error(error.message);
    setNewPassword("");
    toast.success("Password updated");
  };

  const changeEmail = async () => {
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) return toast.error(error.message);
    toast.success("Email change requested. Check your inbox.");
  };

  const deleteAccount = async () => {
    if (!confirm("Delete your account and all chats? This cannot be undone.")) return;
    // Just delete profile; auth user requires admin.
    // The user_id filter is redundant behind RLS and deliberate: an unfiltered
    // delete on a shared table is one policy regression away from being a very
    // bad statement, and this one cannot be undone.
    const userId = memoryQ.data?.userId;
    if (!userId) return toast.error("Couldn't confirm your session. Please sign in again.");
    const { error } = await supabase.from("chats").delete().eq("user_id", userId);
    if (error) return toast.error("Couldn't clear your chats. Please try again.");
    clearLocalUserData();
    await supabase.auth.signOut();
    toast.success("Chats cleared and signed out. Contact support to fully remove your account.");
    navigate({ to: "/" });
  };

  return (
    <AuthedShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 h-8 gap-1.5 text-muted-foreground">
            <Link to="/chat"><ArrowLeft className="h-4 w-4" /> Back to chat</Link>
          </Button>
          <h1 className="font-display text-3xl font-bold">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your account details.</p>

          <Card className="mt-6 p-6">
            <h2 className="font-display text-lg font-semibold">Personal info</h2>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">Full name</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Username</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
              <Button onClick={saveProfile}>Save changes</Button>
            </div>
          </Card>

          <Card className="mt-4 p-6">
            <h2 className="font-display text-lg font-semibold">What Manipuri AI remembers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Details picked up from your conversations, used to personalize replies. Edit or clear
              any of it — changes apply from your next message.
            </p>

            {memoryQ.isPending ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : memoryQ.isError ? (
              <div className="mt-4 text-sm">
                <p className="text-muted-foreground">Couldn't load this right now.</p>
                <Button variant="outline" size="sm" className="mt-2 h-8" onClick={() => memoryQ.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">What to call you</Label>
                    <Input
                      value={memName}
                      maxLength={MAX_SHORT}
                      onChange={(e) => setMemName(e.target.value)}
                      placeholder="Not set"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Preferred language or script</Label>
                    <Input
                      value={memLanguage}
                      maxLength={MAX_SHORT}
                      onChange={(e) => setMemLanguage(e.target.value)}
                      placeholder="e.g. Meiteilon in Meitei Mayek"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Work or study</Label>
                  <Input
                    value={memOccupation}
                    maxLength={MAX_SHORT}
                    onChange={(e) => setMemOccupation(e.target.value)}
                    placeholder="Not set"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Interests</Label>
                  <Input
                    value={memInterests}
                    onChange={(e) => setMemInterests(e.target.value)}
                    placeholder="Separate with commas"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Topics you come back to</Label>
                  <Input
                    value={memTopics}
                    onChange={(e) => setMemTopics(e.target.value)}
                    placeholder="Separate with commas"
                  />
                </div>
                <div className="space-y-1.5">
                  {/* `notes` is the one field the assistant treats as standing
                      guidance, so it doubles as the custom-instructions surface —
                      one instruction per line, exactly how it is stored. */}
                  <Label className="text-xs">How you want replies written</Label>
                  <Textarea
                    value={memNotes}
                    onChange={(e) => setMemNotes(e.target.value)}
                    rows={4}
                    placeholder={"One per line, e.g.\nKeep answers short\nAlways give the Meitei Mayek spelling"}
                    className="resize-none text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Up to {MAX_NOTES} lines. Manipuri AI reads the most recent few with every message.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button onClick={saveMemory} disabled={savingMemory} className="gap-1.5">
                    {savingMemory && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save changes
                  </Button>
                  <Button variant="ghost" onClick={forgetEverything} className="text-destructive hover:text-destructive">
                    Erase memory
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="mt-4 p-6">
            <h2 className="font-display text-lg font-semibold">Email</h2>
            <div className="mt-4 flex gap-2">
              <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <Button variant="outline" onClick={changeEmail}>Update</Button>
            </div>
          </Card>

          <Card className="mt-4 p-6">
            <h2 className="font-display text-lg font-semibold">Password</h2>
            <div className="mt-4 flex gap-2">
              <Input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Button variant="outline" onClick={changePassword}>Change</Button>
            </div>
          </Card>

          <Card className="mt-4 border-destructive/40 p-6">
            <h2 className="font-display text-lg font-semibold text-destructive">Danger zone</h2>
            <p className="mt-1 text-sm text-muted-foreground">Delete your chats and sign out.</p>
            <Button variant="destructive" className="mt-4" onClick={deleteAccount}>Delete my data</Button>
          </Card>
        </div>
      </div>
    </AuthedShell>
  );
}
