import type { PresetId, RateZone } from "@/lib/cardiac";

export type Locale = "en" | "el";

export const LOCALES: readonly { id: Locale; short: string; name: string }[] = [
  { id: "en", short: "EN", name: "English" },
  { id: "el", short: "ΕΛ", name: "Ελληνικά" },
];

export interface Messages {
  appName: string;
  subtitle: string;
  disclaimer: string;
  language: string;
  heartSection: string;
  liveModel: string;
  heartAlt: string;
  rhythmTrace: string;
  grid: string;
  ecgAlt: (bpm: number) => string;
  heartRate: string;
  oneBeat: string;
  systole: string;
  diastole: string;
  systoleHint: string;
  diastoleHint: string;
  timingsNote: string;
  controls: string;
  range: (min: number, max: number) => string;
  bpmValueText: (bpm: number) => string;
  presets: string;
  presetLabels: Record<PresetId, string>;
  pause: string;
  play: string;
  pauseAria: string;
  resumeAria: string;
  soundOn: string;
  soundOff: string;
  soundAria: string;
  volume: string;
  percent: (value: number) => string;
  soundUnavailable: string;
  soundOnNote: string;
  soundOffNote: string;
  zones: Record<RateZone, { title: string; body: string }>;
  howItWorks: string;
  howItWorksHint: string;
  topics: { title: string; body: string }[];
  variationLead: string;
  variationBody: string;
  footer: string;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: {
    appName: "Heartbeat Simulator",
    subtitle: "Explore the rhythm of the human heart.",
    disclaimer:
      "An educational illustration, not a medical device. It does not measure, monitor or diagnose anything.",
    language: "Language",
    heartSection: "Heart visualization",
    liveModel: "Live model",
    heartAlt:
      "Animated illustration of a beating human heart. The upper chambers squeeze first, then the lower chambers contract and relax.",
    rhythmTrace: "Rhythm trace",
    grid: "grid: 200 ms / 1 s",
    ecgAlt: (bpm) =>
      `Simulated ECG-style waveform at ${bpm} beats per minute. Peaks sit closer together as the rate rises.`,
    heartRate: "Heart rate",
    oneBeat: "One beat",
    systole: "Systole",
    diastole: "Diastole",
    systoleHint: "contract",
    diastoleHint: "relax and refill",
    timingsNote: "Timings come from this simplified model. Real hearts vary.",
    controls: "Controls",
    range: (min, max) => `${min} to ${max} BPM`,
    bpmValueText: (bpm) => `${bpm} beats per minute`,
    presets: "Presets",
    presetLabels: {
      resting: "Resting",
      normal: "Normal example",
      walking: "Walking",
      running: "Running",
      fast: "Fast",
    },
    pause: "Pause",
    play: "Play",
    pauseAria: "Pause heartbeat",
    resumeAria: "Resume heartbeat",
    soundOn: "Sound on",
    soundOff: "Sound off",
    soundAria: "Heartbeat sound",
    volume: "Volume",
    percent: (value) => `${value} percent`,
    soundUnavailable:
      "Sound is not available in this browser. Everything else works without it.",
    soundOnNote: "A soft synthesised lub-dub plays with each beat.",
    soundOffNote: "Sound stays off until you turn it on.",
    zones: {
      verySlow: {
        title: "Very slow rhythm",
        body: "Rates like this can show up during deep sleep or in some well-trained endurance athletes. Notice the long pause between beats.",
      },
      resting: {
        title: "Calm, resting pace",
        body: "A pace often seen when someone is sitting quietly or relaxing. The heart has plenty of time to refill between beats.",
      },
      everyday: {
        title: "Easy, everyday pace",
        body: "A common example of a heart rate during quiet daily activity, like reading or working at a desk.",
      },
      light: {
        title: "Light activity",
        body: "Similar to what many people see during a brisk walk or climbing stairs. Muscles are asking for a little more oxygen.",
      },
      hard: {
        title: "Working hard",
        body: "A pace typical of jogging, running or cycling. Beats come closer together and the resting phase gets noticeably shorter.",
      },
      veryFast: {
        title: "Very fast rhythm",
        body: "Similar to an all-out effort such as sprinting. There is very little pause left between one beat and the next.",
      },
    },
    howItWorks: "How it works",
    howItWorksHint: "four ideas, in plain language",
    topics: [
      {
        title: "What BPM means",
        body: "BPM stands for beats per minute: how many times the heart beats in sixty seconds. At 60 BPM there is one beat every second. At 120 BPM there are two.",
      },
      {
        title: "Systole",
        body: "Systole is the squeeze. The muscular lower chambers (the ventricles) contract and push blood out to the lungs and the rest of the body. This is the moment the heart above tightens and twists.",
      },
      {
        title: "Diastole",
        body: "Diastole is the pause. The muscle relaxes and the chambers refill with blood, ready for the next beat. When the heart speeds up, this resting phase shortens the most.",
      },
      {
        title: "Why activity speeds it up",
        body: "Working muscles use more oxygen. The body signals the heart to beat faster and harder so more oxygen-rich blood is delivered each minute, then lets it slow again as you recover.",
      },
    ],
    variationLead: "Everyone is different.",
    variationBody:
      "Resting heart rates and the way the heart responds to exercise vary from person to person with age, fitness, medication, sleep, stress and many other things. The presets here are illustrative examples, and a BPM number on its own does not tell you whether a heart is healthy. For questions about your own heart, talk to a healthcare professional.",
    footer: "Simplified visual representation. Not a physiological model.",
  },
  el: {
    appName: "Προσομοιωτής Καρδιακού Παλμού",
    subtitle: "Εξερεύνησε τον ρυθμό της ανθρώπινης καρδιάς.",
    disclaimer:
      "Εκπαιδευτική απεικόνιση, όχι ιατρική συσκευή. Δεν μετρά, δεν παρακολουθεί και δεν διαγιγνώσκει τίποτα.",
    language: "Γλώσσα",
    heartSection: "Απεικόνιση καρδιάς",
    liveModel: "Ζωντανό μοντέλο",
    heartAlt:
      "Κινούμενη απεικόνιση ανθρώπινης καρδιάς που χτυπά. Πρώτα συσπώνται οι πάνω κοιλότητες, έπειτα οι κάτω κοιλότητες συσπώνται και χαλαρώνουν.",
    rhythmTrace: "Καταγραφή ρυθμού",
    grid: "πλέγμα: 200 ms / 1 s",
    ecgAlt: (bpm) =>
      `Προσομοιωμένη κυματομορφή τύπου ΗΚΓ στους ${bpm} παλμούς το λεπτό. Οι κορυφές πλησιάζουν μεταξύ τους όσο ανεβαίνει ο ρυθμός.`,
    heartRate: "Καρδιακή συχνότητα",
    oneBeat: "Ένας παλμός",
    systole: "Συστολή",
    diastole: "Διαστολή",
    systoleHint: "σύσπαση",
    diastoleHint: "χαλάρωση και γέμισμα",
    timingsNote:
      "Οι χρόνοι προκύπτουν από αυτό το απλοποιημένο μοντέλο. Οι πραγματικές καρδιές διαφέρουν.",
    controls: "Χειριστήρια",
    range: (min, max) => `${min} έως ${max} BPM`,
    bpmValueText: (bpm) => `${bpm} παλμοί το λεπτό`,
    presets: "Προεπιλογές",
    presetLabels: {
      resting: "Ηρεμία",
      normal: "Τυπικό παράδειγμα",
      walking: "Περπάτημα",
      running: "Τρέξιμο",
      fast: "Γρήγορος",
    },
    pause: "Παύση",
    play: "Έναρξη",
    pauseAria: "Παύση καρδιακού παλμού",
    resumeAria: "Συνέχιση καρδιακού παλμού",
    soundOn: "Με ήχο",
    soundOff: "Χωρίς ήχο",
    soundAria: "Ήχος καρδιακού παλμού",
    volume: "Ένταση",
    percent: (value) => `${value} τοις εκατό`,
    soundUnavailable:
      "Ο ήχος δεν είναι διαθέσιμος σε αυτό το πρόγραμμα περιήγησης. Όλα τα υπόλοιπα λειτουργούν κανονικά.",
    soundOnNote: "Ένα απαλό συνθετικό «λαμπ-νταπ» ακούγεται σε κάθε παλμό.",
    soundOffNote: "Ο ήχος μένει κλειστός μέχρι να τον ενεργοποιήσεις.",
    zones: {
      verySlow: {
        title: "Πολύ αργός ρυθμός",
        body: "Τέτοιες τιμές μπορεί να εμφανιστούν στον βαθύ ύπνο ή σε ορισμένους καλά προπονημένους αθλητές αντοχής. Πρόσεξε τη μεγάλη παύση ανάμεσα στους παλμούς.",
      },
      resting: {
        title: "Ήρεμος ρυθμός ηρεμίας",
        body: "Ρυθμός που συναντάται συχνά όταν κάποιος κάθεται ήσυχα ή χαλαρώνει. Η καρδιά έχει άφθονο χρόνο να ξαναγεμίσει ανάμεσα στους παλμούς.",
      },
      everyday: {
        title: "Άνετος, καθημερινός ρυθμός",
        body: "Συνηθισμένο παράδειγμα καρδιακής συχνότητας σε ήρεμη καθημερινή δραστηριότητα, όπως το διάβασμα ή η δουλειά σε γραφείο.",
      },
      light: {
        title: "Ελαφριά δραστηριότητα",
        body: "Παρόμοιο με αυτό που βλέπουν πολλοί άνθρωποι σε γρήγορο περπάτημα ή όταν ανεβαίνουν σκάλες. Οι μύες ζητούν λίγο περισσότερο οξυγόνο.",
      },
      hard: {
        title: "Έντονη προσπάθεια",
        body: "Ρυθμός τυπικός για τζόκινγκ, τρέξιμο ή ποδηλασία. Οι παλμοί πλησιάζουν μεταξύ τους και η φάση ξεκούρασης μικραίνει αισθητά.",
      },
      veryFast: {
        title: "Πολύ γρήγορος ρυθμός",
        body: "Παρόμοιο με μέγιστη προσπάθεια, όπως ένα σπριντ. Απομένει ελάχιστη παύση ανάμεσα στον έναν παλμό και τον επόμενο.",
      },
    },
    howItWorks: "Πώς λειτουργεί",
    howItWorksHint: "τέσσερις ιδέες, με απλά λόγια",
    topics: [
      {
        title: "Τι σημαίνει BPM",
        body: "BPM σημαίνει παλμοί ανά λεπτό (beats per minute): πόσες φορές χτυπά η καρδιά σε εξήντα δευτερόλεπτα. Στα 60 BPM υπάρχει ένας παλμός κάθε δευτερόλεπτο. Στα 120 BPM υπάρχουν δύο.",
      },
      {
        title: "Συστολή",
        body: "Η συστολή είναι το σφίξιμο. Οι μυώδεις κάτω κοιλότητες (οι κοιλίες) συσπώνται και σπρώχνουν το αίμα προς τους πνεύμονες και το υπόλοιπο σώμα. Είναι η στιγμή που η καρδιά παραπάνω σφίγγει και στρίβει.",
      },
      {
        title: "Διαστολή",
        body: "Η διαστολή είναι η παύση. Ο μυς χαλαρώνει και οι κοιλότητες ξαναγεμίζουν με αίμα, έτοιμες για τον επόμενο παλμό. Όταν η καρδιά επιταχύνει, αυτή η φάση ξεκούρασης μικραίνει περισσότερο από όλες.",
      },
      {
        title: "Γιατί η άσκηση την επιταχύνει",
        body: "Οι μύες που δουλεύουν καταναλώνουν περισσότερο οξυγόνο. Το σώμα δίνει σήμα στην καρδιά να χτυπά πιο γρήγορα και πιο δυνατά, ώστε να φτάνει περισσότερο οξυγονωμένο αίμα κάθε λεπτό, και την αφήνει να επιβραδύνει ξανά καθώς ξεκουράζεσαι.",
      },
    ],
    variationLead: "Κάθε άνθρωπος είναι διαφορετικός.",
    variationBody:
      "Η καρδιακή συχνότητα ηρεμίας και ο τρόπος που η καρδιά ανταποκρίνεται στην άσκηση διαφέρουν από άνθρωπο σε άνθρωπο, ανάλογα με την ηλικία, τη φυσική κατάσταση, τα φάρμακα, τον ύπνο, το άγχος και πολλά άλλα. Οι προεπιλογές εδώ είναι ενδεικτικά παραδείγματα, και ένας αριθμός BPM από μόνος του δεν δείχνει αν μια καρδιά είναι υγιής. Για ερωτήσεις σχετικά με τη δική σου καρδιά, μίλησε με έναν επαγγελματία υγείας.",
    footer: "Απλοποιημένη οπτική αναπαράσταση. Όχι φυσιολογικό μοντέλο.",
  },
};
