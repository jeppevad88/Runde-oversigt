# U11 Holdoversigt – iCal version 17

Denne version bevarer den eksisterende U11-hjemmeside og henter kampprogrammet fra de syv iCal-kalendere via en Supabase Edge Function.

## Hvorfor Edge Function?
GitHub Pages kører i browseren. Dansk Håndbolds iCal-server tillader ikke nødvendigvis direkte browser-hentning (CORS), og det kunne få siden til at stå på “Forbinder…” i stedet for at indlæse resten af appen. Edge Function henter kalenderfilerne server-side.

## Installation
1. Upload filerne i denne ZIP til test-repositoryet (behold den eksisterende Supabase-konfiguration i `config.js`).
2. Installer Supabase CLI, og log ind:
   `supabase login`
3. Fra mappen med projektet, link til det eksisterende Supabase-projekt:
   `supabase link --project-ref jgcufgjezxxrbxarucam`
4. Deploy funktionen:
   `supabase functions deploy u11-ical-sync`
5. Kontrollér, at GitHub Pages bruger den testgren/branch, som du ønsker at teste, eller at filerne er committed til den branch, som GitHub Pages publicerer.
6. Genindlæs siden. Hvis funktionen er deployet, bør statuslinjen sige, at kampprogrammet er opdateret fra iCal.

## Vigtigt
- Dette ændrer ikke `u11_state` eller spillerdata i Supabase.
- Den aktive hjemmeside bør ikke ændres, før testversionen er kontrolleret.
- Hvis Edge Function ikke er deployet, bruger appen det indbyggede kampprogram og forsøger stadig at indlæse spillerdata.
- Kalendernes klokkeslæt og puljer skal verificeres på den publicerede testside, før versionen bruges i drift.
