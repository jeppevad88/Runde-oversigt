# U11 Holdfordeler v5 – GitHub + Supabase

Fælles webværktøj til at fordele U11-spillere på kampe.

## Funktioner
- Én fane pr. spillerunde
- Kun Hjallerup-hold med kamp i den valgte runde vises
- Maks. 8 spillere pr. hold
- Spillere kan lånes til flere hold i samme runde – også 2 eller 3 hold
- En spiller kan fjernes ved afbud
- Afbud gemmes og vises i en særskilt boks under holdet
- Spillerstatistik grupperes efter spillerens oprindelige hold
- Statistik viser egne kampe, ekstra kampe for andre hold og hvilke hold
- Fælles lagring i Supabase

## GitHub Pages
Upload alle filer til repositoryets rod og vælg:
- Settings → Pages
- Deploy from a branch
- Branch: main
- Folder: / (root)

## Supabase
`supabase.sql` bruges til den oprindelige tabelopsætning.

Den nuværende version gemmer holdets pladser og afbud samlet i JSON-feltet `players`, så databasen ikke behøver en ny kolonne.


## v5
Første opstart kan automatisk oprette grunddata i `u11_state`, hvis tabellen er tom. Forbindelsesfejl vises tydeligt i statusfeltet i stedet for at hænge på “Forbinder…”. Supabase skal ikke seedes manuelt.


### Layout
Versionen bruger Hjallerup IF-logoet som diskret vandmærke. Husk at uploade `Hjallerup-IF-Logo.jpg` sammen med de øvrige filer.
