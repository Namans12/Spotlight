# Tonight ranking evaluation

Run `npm run evaluate:tonight` to compare the existing Tonight ranking with the optional-feedback ranking. Both use the same candidates and filters; the baseline has no feedback weights. Candidates already dismissed are excluded from both inputs. The script reports reciprocal rank for the first hand-labelled relevant title and mean reciprocal rank (MRR) across four examples.

These examples are synthetic regression probes, constructed to check that a negative genre signal changes ordering and that watched or unavailable feedback does not penalize a genre. They are not independent user judgments, production traffic, or evidence of improved satisfaction. The current expected MRR is 0.75 for the baseline and 1.00 with feedback on these four constructed examples.

Each case also reports precision among up to the first three eligible options, the fraction of labelled relevant titles present in the eligible set, and the eligible count. The paired comparison rejects mismatched or duplicate eligible identities. Keys distinguish movies from TV shows. Coverage is null when no relevant titles have been labelled; a missing label is not evidence of a dislike.

Feedback stays in the current page session and is not sent to a server. A meaningful quality comparison would require a larger independently labelled, representative set or an explicitly opt-in user study, with the same eligibility constraints for both rankings and attention to coverage as well as ranking quality.
