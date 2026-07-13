import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { AuthedShell } from "@/components/AuthedShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — Manipuri AI" }] }),
  component: ProfilePage,
});

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
    // Just delete profile; auth user requires admin
    await supabase.from("chats").delete().neq("id", "00000000-0000-0000-0000-000000000000");
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
