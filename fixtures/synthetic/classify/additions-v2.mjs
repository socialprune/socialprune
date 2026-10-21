// All people, places, groups and situations below are invented, never copied from real posts.
// Fiction provenance stays here and in metadata, not as a cue in the post text.
// Coverage intentions are not expected human labels. Not served by the labeller.
// Each block: ten German fits, ten English fits, ten German near misses, ten English near misses.
export const additions = [];
export function materializeAdditions() {
  return additions.map((row, i) => {
    const id = `s2-${String(401 + i).padStart(3, '0')}`;
    const platform = i % 2 ? 'instagram' : 'x';
    const kind = ['post', 'reply', 'quote', 'repost', 'comment'][i % 5];
    return { id, platform, kind, mediaCount: null, account: { key: `s2-${platform}-invented`, handle: 'zava_fenn_demo' }, text: row.text,
      createdAt: new Date(Date.UTC(2012 + i % 15, i % 8, 1 + i % 27, i % 24, i % 60)).toISOString(),
      engagement: { likes: i % 7 ? (i * 13) % 57 : null, reposts: i % 9 ? (i * 3) % 8 : null },
      reference: { replyToId: kind === 'reply' ? `invented-parent-v2-${i}` : null,
        replyToHandle: kind === 'reply' ? 'nerlo_quast_demo' : null,
        quotedId: kind === 'quote' ? `invented-quote-v2-${i}` : null,
        repostOfHandle: kind === 'repost' ? 'veska_dorn_demo' : null,
        ownerHandle: kind === 'comment' ? 'jolvi_nebel_demo' : null },
      url: `https://example.org/s2/${id}`, provenance: { archive: 's2-eval', file: 'additions-v2.mjs', index: i } };
  });
}
function block(focus, language, role, texts) {
  for (const [index, text] of texts.entries()) additions.push({ focus, language, role,
    overlap: index < 4 ? ['political', 'personal-attack', 'sexual', 'toxic'][index % 4] : null,
    text, phenomena: ['adr032-addition', role, ...(index < 4 ? ['overlap-intent'] : [])] });
}
block('racist', 'de', 'fit-intent', [
  'Ich wähle in Nebelhafen die Blattpartei, weil sie Menschen aus Velun aus jedem Verein ausschließen will. Die gehören hier nicht dazu.',
  'Nerlo Quast, du bist unfähig. Leute mit deiner dunklen Haut können ohnehin nichts.',
  'Bin 34 und will mit Erwachsenen aus Velun nur Sex, keine Beziehung. Wegen ihrer Herkunft sind die für mich keine gleichwertigen Partner.',
  'Alles ist zum Kotzen. Menschen aus Velun sind minderwertig und sollen aus unserem Viertel verschwinden.',
  'In unseren Gemeinschaftsraum in Kelmau kommen keine Menschen mit dunkler Haut. Die sind weniger wert als wir.',
  'Von Leuten aus Velun erwarte ich nichts. Die sind durch ihre Herkunft einfach weniger fähig.',
  'Warum soll ich Menschen aus Velun genauso respektieren wie uns? Die kommen von dort, das sagt doch alles.',
  'Menschen aus Velun gehören wegen ihrer Herkunft nicht in unsere Schule, egal wie gut sie lernen.',
  'In meinem Sportverein darf niemand aus Velun mitmachen. Für mich ist diese Herkunft minderwertig.',
  'Ja, ich nenne den Nachbarn wegen seiner Hautfarbe [Schimpfwort]. Genau das halte ich von solchen Leuten.',
]);
block('racist', 'en', 'fit-intent', [
  'The Lantern Party gets my vote for banning people from Velun from public clubs. Their origin makes them worth less.',
  'Nerlo Quast, you are a worthless fool. Your dark skin tells me your whole family is inferior.',
  'At 34 I date other adults from Velun for sex only. Their origin makes them exotic bodies to me, never equal partners.',
  'This whole mess can rot. People from Velun are inferior and should leave our street.',
  'No dark-skinned people in our shared room in Kelmau. They are worth less than us.',
  'You cannot expect much from people from Velun. Their origin makes them less capable from birth.',
  'People from Velun do not deserve the same respect as us. Where they come from tells you their worth.',
  'Our school should reject people from Velun. Being from there makes them inferior, whatever their grades.',
  'Keep dark-skinned people out of our rowing club. I do not see them as our equals.',
  'Yes, I call the neighbour [slur] because of where he comes from. That is what I think of his people.',
]);
block('racist', 'de', 'near-miss-intent', [
  'Gleiche Vereinsrechte in Nebelhafen, dafür stimme ich. Die Behauptung, Menschen aus Velun seien minderwertig, ist rassistisch und falsch.',
  'Nerlo Quast, du bist ein mieser Lügner, wenn du behauptest, eine Hautfarbe bestimme den Wert eines Menschen.',
  'Wir sind beide über dreißig und reden über Sex. Diese exotisierenden Klischees über Leute aus Velun wollen wir beide nicht im Bett hören.',
  'Dieser ganze Mist nervt. Im Vereinsbericht steht doch gerade, dass rassistische Ausgrenzung nicht geduldet wird.',
  'In der Werkstatt wurde eine rassistische Aussage gemeldet. Gut, dass der Bericht sich klar dagegen ausspricht.',
  'Im Kurs stand: Menschen aus Velun seien weniger wert. Wir haben den Satz zitiert und dann besprochen, warum diese Abwertung falsch ist.',
  'Eine Hautfarbe macht niemanden weniger wert. Auch nicht in unserem Club.',
  'Der Buchtext nennt Leute [Schimpfwort]. Das ist rassistisch, daran ändert auch die schönste Sprache im Rest nichts.',
  'Ich komme aus Velun. Das Essen dort fehlt mir hier in Kelmau schon ein bisschen.',
  'Wir zwei aus Velun heißen bei unserem Teeabend jetzt Veluner Teekönige. War unser gemeinsamer Vorschlag, wir lachen beide darüber, nicht übereinander.',
]);
block('racist', 'en', 'near-miss-intent', [
  'I vote for equal club rights in Kelmau. Calling people from Velun inferior is racist and wrong.',
  'Nerlo Quast, you are a dishonest fool for claiming that skin colour determines human worth.',
  'We are both over thirty and talk openly about sex. Neither of us wants those exoticising stereotypes about people from Velun in bed.',
  'This whole situation is rubbish. The club report condemns racist exclusions, it does not ask for them.',
  'A racist remark was reported at the workshop. Glad the report takes a clear stand against it.',
  'Our class quoted the claim that people from Velun are inferior, then explained why that claim is wrong.',
  'Skin colour does not make anyone worth less. That applies in our club too.',
  'The review calls [slur] a racist insult and rejects its use. That criticism is why I shared it.',
  'My family is from Velun. We still cook the food I grew up with.',
  'The two of us from Velun named our tea nights the Velun Tea Kings. We both chose it and laugh together, not at each other.',
]);
block('misogynistic', 'de', 'fit-intent', [
  'Frauen sollte man das Wahlrecht nehmen. Die sind zum politischen Denken zu dumm.',
  'Veska Dorn, du bist unfähig, weil du eine Frau bist. Keine Frau kann eine Werkstatt leiten.',
  'Ich bin 35, meine Dates sind erwachsen. Frauen sind für mich bloß Körper für Sex, ihre Meinung zählt nicht.',
  'Dieser ganze Mist kann verrotten. Frauen sind zu minderwertig für unsere Leitung.',
  'Frauen taugen nicht für Verantwortung. Das liegt am Frausein, nicht an ihrer Ausbildung.',
  'Keine Frau sollte uns anleiten dürfen. Die sind grundsätzlich weniger fähig als Männer.',
  'Was eine Frau sagt, zählt für mich immer weniger als die Meinung eines Mannes.',
  'Frauen sollten keine Verträge für unseren Club unterschreiben dürfen. So etwas gehört nicht in Frauenhände.',
  'In meinem Verein haben Frauen nichts zu sagen. Einfach weil sie Frauen sind.',
  'Die neue Chefin ist für mich nur eine [Schimpfwort]. Frauen haben in der Leitung nichts verloren.',
]);
block('misogynistic', 'en', 'fit-intent', [
  'Take the vote away from women. They are too stupid to understand policy.',
  'Veska Dorn, you are incompetent because you are a woman. No woman can lead a workshop.',
  'I am 35 and date adults only. Women are just bodies for sex to me, not people whose views matter.',
  'This entire mess can rot. Women are too inferior to sit on our board.',
  'Women are unfit for responsibility. Being a woman is the problem, whatever training they have.',
  'No woman should direct our work. Women are naturally less capable than men.',
  'An opinion from a woman always counts less to me than one from a man.',
  'Women should never sign our club contracts. You cannot trust women with that sort of thing.',
  'Our club should ignore women. Being women is reason enough.',
  'The new manager is just a [slur] to me. Women have no place in management.',
]);
block('misogynistic', 'de', 'near-miss-intent', [
  'Gleiches Wahlrecht, ohne Ausnahme. Wer Frauen für zu dumm zum Denken hält, hat meine Stimme nicht.',
  'Nerlo Quast, du bist eine miserable Betrügerin, weil du die Vereinskasse gestohlen hast, nicht weil du eine Frau bist.',
  'Wir sind beide erwachsen und reden über Sex. Dass eine Frau niemandem Sex schuldet, ist für uns beide klar.',
  'Dieser ganze Mist nervt. Der Bericht kritisiert doch gerade, dass der Club Frauen ausschließt.',
  'Im Werkstattbericht steht, Frauen könnten nicht leiten. Gut, dass die Autorin diese Behauptung als frauenfeindlich zurückweist.',
  'Frauen sind nicht weniger fähig als Männer. Das sollte im Kurs nicht mehr zur Debatte stehen.',
  'Gleiche Verantwortung im Club. Frauen abzuwerten bringt uns keinen Schritt weiter.',
  'Im Bericht wird [Schimpfwort] als frauenfeindliche Beleidigung zurückgewiesen. Diese Kritik teile ich.',
  'Ich bin eine Frau und leite seit Montag die neue Werkstatt.',
  'Veska und ich nennen uns Königinnen der Schraubenzieher. Haben wir beide so beschlossen, ein gemeinsamer Witz über unsere Werkzeugliebe, nicht gegen Frauen.',
]);
block('misogynistic', 'en', 'near-miss-intent', [
  'Equal voting rights, no exceptions. Anyone claiming women are too stupid to think will not get my vote.',
  'Nerlo Quast, you are a miserable fraud for stealing the club funds, not for being a woman.',
  'We are both adults and talk about sex. Neither of us thinks a woman owes anyone sexual access.',
  'This entire mess is rubbish. The report criticises the club for excluding women, it does not support it.',
  'The workshop report quotes the claim that women cannot lead, then calls it misogynistic. Glad someone challenged it.',
  'Women are not less capable than men. We should not have to keep explaining that in class.',
  'Equal responsibility in the club. Putting women down gets us nowhere.',
  'The report identifies [slur] as a misogynistic insult and rejects it. I agree with that criticism.',
  'I am a woman and I started running our new workshop on Monday.',
  'Veska and I chose Queens of the Screwdrivers as our nickname. We both enjoy our joke about loving tools; we are not putting women down.',
]);
block('group-hostility', 'de', 'fit-intent', [
  'Menschen mit Behinderung gehören nicht in öffentliche Ämter. Ich will sie dort ausschließen, weil sie weniger wert sind.',
  'Nerlo Quast, du bist ein wertloser Trottel. Als schwuler Mann bist du in unserem Verein unerwünscht.',
  'Ich bin 36 und suche nur erwachsene Dates. Trans Menschen sind für mich sexuelle Kuriositäten, keine gleichwertigen Partner.',
  'Diese ganze Sache kann verrotten. Menschen aus der Lumenreligion sind minderwertig.',
  'Alte Menschen sind nichts mehr wert. Die sollen aus unserem Verein draußen bleiben.',
  'Menschen mit Behinderung sind für uns nur eine Belastung. Die verdienen hier keinen Platz.',
  'Lesbische Frauen gehören nicht als Gleichberechtigte in unseren Club. Ich verachte diese Sexualität.',
  'Nichtbinäre Menschen sollen aus unserem Chor verschwinden. Die sind weniger wert als wir.',
  'In meiner Werkstatt stelle ich niemanden aus der Lumenreligion ein. Ich verachte diese Menschen wegen ihres Glaubens.',
  'Mein Nachbar ist für mich wegen seiner Behinderung ein [Schimpfwort]. Solche Leute will ich hier nicht haben.',
]);
block('group-hostility', 'en', 'fit-intent', [
  'Disabled people should be excluded from public office. I want them kept out because I consider them inferior.',
  'Nerlo Quast, you are a worthless fool. As a gay man you are not welcome in our club.',
  'I am 36 and date adults only. Trans people are sexual curiosities to me, not equal partners.',
  'This whole mess can rot. Followers of the Lumen faith are lesser people.',
  'Older people are no longer worth anything. They should stay out of our club.',
  'Disabled people are only a burden to us. They do not deserve a place in our workshop.',
  'Lesbians do not belong here as equals. I despise their sexuality.',
  'Nonbinary people should leave our choir. They are worth less than us.',
  'My workshop must never hire followers of the Lumen faith. I despise people for holding that belief.',
  'My neighbour is a [slur] because of his disability. I do not want people like that living here.',
]);
block('group-hostility', 'de', 'near-miss-intent', [
  'Ich will barrierefreie Ämter und gleiche Chancen bei der Ratswahl. Menschen mit Behinderung sind nicht weniger wert.',
  'Nerlo Quast, du bist ein mieser Lügner, wenn du behauptest, schwule Männer seien weniger wert.',
  'Wir sind beide erwachsen und reden über Sex. Trans Menschen als bloße sexuelle Kuriositäten zu behandeln geht für uns beide gar nicht.',
  'Dieser ganze Mist nervt. Der Bericht verurteilt die Ausgrenzung von Menschen der Lumenreligion, er unterstützt sie nicht.',
  'Mit der Auslegung dieser Lumenlehre bin ich nicht einverstanden. Das macht ihre Gläubigen nicht weniger wert.',
  'Gut, dass unser Verein sich gegen die Abwertung von Menschen mit Behinderung ausspricht.',
  'Lesbische Frauen sind nicht weniger wert. Schön, dass der Kurs das klarstellt.',
  'Im Bericht wird [Schimpfwort] zitiert, um diese behindertenfeindliche Sprache zu kritisieren. Die Kritik ist berechtigt.',
  'Ich bin nichtbinär und singe seit letzter Woche im Chor.',
  'Wir älteren Freunde mit Rollator heißen jetzt Rollator-Renncrew. Haben wir alle zusammen ausgesucht, wir lachen miteinander und machen niemanden klein.',
]);
block('group-hostility', 'en', 'near-miss-intent', [
  'I want accessible public offices and equal chances in council elections. Disabled people are not inferior.',
  'Nerlo Quast, you are a dishonest fool for claiming gay men have less worth.',
  'We are both adults talking about sex. Neither of us accepts treating trans people as sexual curiosities instead of equals.',
  'This whole mess is rubbish. The report condemns excluding followers of the Lumen faith, it does not endorse it.',
  'I disagree with the Lumen institution on its reading of that doctrine. That says nothing about the worth of its believers.',
  'Glad our club spoke out against putting disabled people down.',
  'Lesbians are not worth less than anyone else. Good to hear that said plainly in class.',
  'The report quotes [slur] to criticise disability-based abuse. I agree with that criticism.',
  'I am nonbinary and joined the choir last week.',
  'We older friends with walking frames chose Walking Frame Racing Crew as our name. We all like it; we laugh together, not at anyone else.',
]);
block('politically-incorrect', 'de', 'fit-intent', [
  'Mehr Busse für Nebelhafen, dafür bin ich. Der Seniorenrat braucht für die Fahrplan-App aber wohl erst einen digitalen Krückstock, haha.',
  'Veska Dorn, du bist ein unfähiger Blender. Und unser Frauenverein braucht wohl rosa Schraubenzieher, damit die Technik klappt, haha.',
  'Im Frauenchor sind wir alle über dreißig. Nach dem Sex sollten wir mal eine Bedienungsanleitung für Männer schreiben, Frauen reden ja grundsätzlich im Rätselmodus, haha.',
  'Diese ganze Sache ist Mist. Der Seniorenclub lädt das WLAN wohl noch mit der Dampfmaschine, haha.',
  'Den Technikabend für Frauen nennen wir dann wohl Kabelsalat mit Handtasche, haha.',
  'Der schwule Tanzverein braucht wohl keinen Innenarchitekten, das steckt schon im Mitgliedsausweis, haha.',
  'Die Männergruppe braucht ein Navi für Gefühle, sonst landet sie wieder beim Werkzeugregal, haha.',
  'Der Seniorenchor braucht für den Download bestimmt einen Lastenaufzug, haha.',
  'Frauen in der Werkstatt, dann bekommt der Hammer wohl erst einmal ein passendes Outfit, haha.',
  'Der Männerlesekreis liest die Anleitung bestimmt erst, wenn das Bücherregal umfällt, haha.',
]);
block('politically-incorrect', 'en', 'fit-intent', [
  'I vote for more buses in Nebelhafen. Our seniors council probably needs a timetable app with a walking stick first, haha.',
  'Veska Dorn, you are an incompetent fraud. Our club for women probably needs pink screwdrivers before the tools work, haha.',
  'We are all over thirty in our choir for women. After sex we should write a manual for men, since women always speak in riddles, haha.',
  'This whole situation is rubbish. Our seniors club probably powers its Wi-Fi with a steam engine, haha.',
  'Technology night for women? We can call it Cables and Handbags, haha.',
  'Our gay dance club probably never needs a decorator. That comes with the membership, haha.',
  'Our group for men needs a feelings satnav or it ends up back at the tool rack, haha.',
  'Our seniors choir probably needs a freight lift for its downloads, haha.',
  'Women in the workshop will surely choose a matching outfit for the hammer first, haha.',
  'Our reading circle for men probably reads the instructions only after the bookcase falls over, haha.',
]);
block('politically-incorrect', 'de', 'near-miss-intent', [
  'Nebelhafen braucht mehr Busse. Der neue Fahrplan des Stadtrats lässt das ganze Viertel am Abend ohne Verbindung stehen.',
  'Veska Dorn, du bist ein dreister Blender. Unser Bericht kritisiert den Spruch über rosa Werkzeuge als abwertendes Frauenklischee, er stimmt ihm nicht zu.',
  'Wir sind beide erwachsen und sprechen über Sex. Dieses Gerede, Frauen sprächen immer in Rätseln, finden wir beide abwertend.',
  'Dieser ganze Mist nervt. Im Seniorenclub fällt ständig das WLAN aus, hoffentlich kommt bald der neue Router.',
  'Im Clubbericht stehen jetzt die Termine für den Technikabend für Frauen. Los geht es am Donnerstag.',
  'Nicht jeder schwule Mann kann gut dekorieren. Warum schleppt unser Tanzclub dieses Klischee immer noch mit?',
  'Männer haben Gefühle und können darüber reden. Das Gegenteil zu behaupten ist ein blödes Klischee.',
  'Der Bericht kritisiert diese Seniorenwitze. Man muss nicht jeden Menschen wegen seines Alters aufziehen.',
  'Ich bin eine ältere Frau und lerne heute, wie der Router funktioniert.',
  'Wir haben beide den Tee umgeworfen und heißen jetzt die Tassenchaoten. Wenigstens lässt sich über unser Missgeschick lachen.',
]);
block('politically-incorrect', 'en', 'near-miss-intent', [
  'Nebelhafen needs more buses. The new council timetable leaves the whole neighbourhood without a service in the evening.',
  'Veska Dorn, you are a brazen fraud. Our report condemns the pink tools remark as a demeaning stereotype about women, it does not endorse it.',
  'We are both adults discussing sex. We both find the claim that women always speak in riddles demeaning.',
  'This whole mess is rubbish. The Wi-Fi keeps failing at our seniors club; I hope the new router arrives soon.',
  'The club report lists the dates for our technology night for women. First one is on Thursday.',
  'Not every gay man is good at decorating. Why does our dance club keep dragging that stereotype around?',
  'Men have feelings and can talk about them. Saying otherwise is a lazy stereotype.',
  'The report criticises those jokes about seniors. You do not have to mock every person for their age.',
  'I am an older woman learning how the router works today.',
  'We both spilled our tea and named ourselves the Spilled Tea Crew. At least we can laugh about our own clumsiness.',
]);
