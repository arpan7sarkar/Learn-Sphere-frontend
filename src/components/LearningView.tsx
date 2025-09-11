import React, { useState, useEffect } from 'react';
import { Lock, CheckCircle, PartyPopper } from 'lucide-react';
import type { Course, QuizResult, QuizProgress } from './index';
import axios from 'axios';
import { useUser } from '@clerk/clerk-react';

interface QuizCompletionResponse {
  message: string;
  passed: boolean;
  score: number;
  totalQuestions: number;
  percentage: number;
  xpEarned: number;
  leveledUp?: boolean;
  newLevel?: number;
  totalXP?: number;
  currentLevel?: number;
  attempts: number;
  requiredPercentage?: number;
  chapterCompleted?: boolean;
  isLastLessonInChapter?: boolean;
}

interface LearningViewProps {
  course: Course;
  onMarkComplete: (courseId: string, chapIdx: number, lessIdx: number, xp: number, quizResult?: Omit<QuizResult, 'date'>) => void;
  quizProgress: QuizProgress | null;
  onUpdateQuizProgress: (progress: QuizProgress) => void;
  onCourseUpdate?: () => void;
}

const LearningView: React.FC<LearningViewProps> = ({ course, onMarkComplete, quizProgress, onUpdateQuizProgress, onCourseUpdate }) => {
    const { user: clerkUser } = useUser();
    const [activeLesson, setActiveLesson] = useState<{ chap: number, less: number } | null>({ chap: 0, less: 0 });
    const [isQuizSubmitted, setIsQuizSubmitted] = useState(false);
    const [quizResult, setQuizResult] = useState<Omit<QuizResult, 'date'> | null>(null);
    const [quizResponse, setQuizResponse] = useState<QuizCompletionResponse | null>(null);
    const [isSubmittingQuiz, setIsSubmittingQuiz] = useState(false);
    const [isRegeneratingQuiz, setIsRegeneratingQuiz] = useState(false);

    const currentLesson = activeLesson ? course.chapters[activeLesson.chap].lessons[activeLesson.less] : null;

    // Derived unlock helpers
    const isChapterUnlocked = (chapIdx: number) => {
        // If explicitly locked flag is false, it's locked; otherwise first chapter unlocked by default
        if (chapIdx === 0) return true;
        return course.chapters[chapIdx].unlocked !== false && course.chapters[chapIdx - 1].completed === true ? true : course.chapters[chapIdx].unlocked === true;
    };
    const isLessonUnlockedFn = (chapIdx: number, lessIdx: number) => {
        if (!isChapterUnlocked(chapIdx)) return false;
        if (lessIdx === 0) return true;
        const prev = course.chapters[chapIdx].lessons[lessIdx - 1];
        // If previous lesson had a quiz, require quizPassed; otherwise require completed
        return prev.quiz ? !!prev.quizPassed : !!prev.completed;
    };

    useEffect(() => {
        setIsQuizSubmitted(false);
        setQuizResult(null);
    }, [activeLesson]);

    const handleQuizAnswer = (questionIndex: number, answer: string) => { 
        if (!activeLesson || !currentLesson || !currentLesson.quiz) return; 
        const progress: QuizProgress = quizProgress ?? { 
            courseId: course.id, 
            chapterIndex: activeLesson.chap, 
            lessonIndex: activeLesson.less, 
            currentQuestionIndex: 0, 
            answers: {}, 
        }; 
        const newAnswers = { ...progress.answers, [questionIndex]: answer }; 
        onUpdateQuizProgress({ ...progress, answers: newAnswers }); 
    };
    
    const handleSubmitQuiz = async () => {
        if (!activeLesson || !currentLesson || !currentLesson.quiz || !clerkUser) return;
        setIsSubmittingQuiz(true);
        const quiz = currentLesson.quiz;
        let correct = 0;
        const answers = quizProgress?.answers || {};
        quiz.questions.forEach((q, i) => { if (answers[i] === q.correctAnswer) { correct++; } });
        
        try {
            const response = await axios.post<QuizCompletionResponse>(`${process.env.VITE_BACKEND_URL}/api/quiz/complete`, {
                userId: clerkUser.id,
                courseId: course.id,
                chapterIndex: activeLesson.chap,
                lessonIndex: activeLesson.less,
                score: correct,
                totalQuestions: quiz.questions.length
            });
            
            setQuizResponse(response.data);
            const result: Omit<QuizResult, 'date'> = { 
                courseId: course.id, 
                quizTitle: quiz.title, 
                score: response.data.percentage,
                correct,
                total: quiz.questions.length
            };
            setQuizResult(result);
            setIsQuizSubmitted(true);
            
            if (response.data.passed) {
                // Call parent to refresh course data instead of reloading page
                if (onCourseUpdate) {
                    onCourseUpdate();
                }
            }
        } catch (error) {
            console.error('Quiz submission error:', error);
            setQuizResponse({ 
                message: 'Failed to submit quiz. Please try again.',
                passed: false,
                score: correct,
                totalQuestions: quiz.questions.length,
                percentage: Math.round((correct / quiz.questions.length) * 100),
                xpEarned: 0,
                attempts: 1,
                requiredPercentage: 75
            });
        } finally {
            setIsSubmittingQuiz(false);
        }
    };

    const handleTryAgain = async () => {
        if (!activeLesson || !clerkUser) return;
        
        setIsRegeneratingQuiz(true);
        try {
            await axios.post(`${process.env.VITE_BACKEND_URL}/api/quiz/regenerate`, {
                userId: clerkUser.id,
                courseId: course.id,
                chapterIndex: activeLesson.chap,
                lessonIndex: activeLesson.less
            });
            
            // Reset quiz state and refresh course data
            setIsQuizSubmitted(false);
            setQuizResult(null);
            setQuizResponse(null);
            onUpdateQuizProgress({
                courseId: course.id,
                chapterIndex: activeLesson.chap,
                lessonIndex: activeLesson.less,
                currentQuestionIndex: 0,
                answers: {}
            });
            
            if (onCourseUpdate) {
                onCourseUpdate();
            }
        } catch (error) {
            console.error('Error regenerating quiz:', error);
            alert('Failed to generate new quiz questions. Please try again.');
        } finally {
            setIsRegeneratingQuiz(false);
        }
    };

    const handleContinue = () => {
        if (!activeLesson || !currentLesson || !quizResult) return;
        // Calculate XP based on the number of correct answers (10 XP per correct answer)
        const xpGainedFromQuiz = quizResult.correct * 10;
        onMarkComplete(course.id, activeLesson.chap, activeLesson.less, xpGainedFromQuiz, quizResult);
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 p-4 sm:p-6">
            {/* Sidebar Navigation */}
            <aside className="lg:w-1/4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-2xl p-4 lg:p-6 h-fit lg:sticky lg:top-24 shadow-md">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    {course.title}
                </h3>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2">
                    {course.chapters.map((chap, chapIdx) => {
                        const isChapterLocked = !isChapterUnlocked(chapIdx);
                        const isChapterCompleted = chap.completed;
                        
                        return (
                        <div key={chapIdx} className="mb-4">
                            <h4 className={`font-semibold mb-2 flex items-center gap-2 ${
                                isChapterLocked ? 'text-gray-400' : 'text-gray-700'
                            }`}>
                                <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${
                                    isChapterLocked 
                                        ? 'bg-gray-100 text-gray-400' 
                                        : isChapterCompleted
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-blue-100 text-blue-700'
                                }`}>
                                    {isChapterLocked ? <Lock className="w-3 h-3" /> : chapIdx + 1}
                                </span>
                                {chap.title}
                                {isChapterCompleted && (
                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                )}
                            </h4>
                            {isChapterLocked && (
                                <div className="text-xs text-gray-400 mb-2 ml-7">
                                    Complete previous chapter to unlock
                                </div>
                            )}
                            <ul className="space-y-1 pl-7">
                                {chap.lessons.map((less, lessIdx) => {
                                    const isLocked = !isLessonUnlockedFn(chapIdx, lessIdx);
                                    const isActive = activeLesson?.chap === chapIdx && activeLesson?.less === lessIdx;
                                    
                                    return (
                                        <li 
                                            key={lessIdx} 
                                            className={`p-2 rounded-md transition-all duration-200 ${
                                                isLocked 
                                                    ? 'opacity-50 cursor-not-allowed bg-gray-100' 
                                                    : 'cursor-pointer hover:bg-gray-50'
                                            } ${
                                                isActive && !isLocked
                                                    ? 'bg-blue-50 text-blue-700 font-medium shadow-sm border border-blue-100' 
                                                    : isLocked ? 'text-gray-400' : 'text-gray-600'
                                            } ${less.completed ? 'text-green-600' : ''}`} 
                                            onClick={() => !isLocked && setActiveLesson({ chap: chapIdx, less: lessIdx })}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    {isLocked && (
                                                        <svg className="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                                        </svg>
                                                    )}
                                                    <span>{less.title}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {less.quizScore !== undefined && less.attempts && less.attempts > 0 && (
                                                        <span className={`text-xs px-2 py-1 rounded ${
                                                            less.quizPassed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                        }`}>
                                                            {less.quizScore}%
                                                        </span>
                                                    )}
                                                    {less.completed && (
                                                        <span className="text-green-500">
                                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                                </svg>
                                                            </span>
                                                    )}
                                                </div>
                                            </div>
                                            {isLocked && (
                                                <div className="text-xs text-gray-400 mt-1">
                                                    Complete previous lesson with 50%+ to unlock
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                    })}
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 bg-white/90 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-md border border-gray-200">
                {currentLesson ? (
                    <div className="max-w-4xl mx-auto">
                        <div className="mb-6 pb-6 border-b border-gray-100">
                            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                                <span>Chapter {activeLesson!.chap + 1}</span>
                                <span>•</span>
                                <span>Lesson {activeLesson!.less + 1}</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">{currentLesson.title}</h2>
                            {currentLesson.completed && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    Completed
                                </span>
                            )}
                        </div>

                        {/* Lesson Content */}
                        <div 
                            className="prose prose-blue max-w-none text-gray-700 mb-8" 
                            dangerouslySetInnerHTML={{ __html: currentLesson.content }}
                        ></div>
                        
                        {/* Locked Lesson Message */}
                        {!isLessonUnlockedFn(activeLesson!.chap, activeLesson!.less) && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mt-8">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="bg-yellow-100 p-2 rounded-lg">
                                        <svg className="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold text-yellow-800">Lesson Locked</h3>
                                </div>
                                <p className="text-yellow-700 mb-4">
                                    You need to complete the previous lesson with at least 50% quiz score to unlock this lesson.
                                </p>
                                <div className="bg-white p-4 rounded-lg border border-yellow-200">
                                    <h4 className="font-semibold text-yellow-800 mb-2">Requirements:</h4>
                                    <ul className="text-yellow-700 space-y-1">
                                        <li>• Complete the previous lesson</li>
                                        <li>• Score 50% or higher on the quiz</li>
                                        <li>• Then this lesson will automatically unlock</li>
                                    </ul>
                                </div>
                            </div>
                        )}

                        {/* Quiz Section */}
                        {currentLesson.quiz && !currentLesson.completed && isLessonUnlockedFn(activeLesson!.chap, activeLesson!.less) && (                            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6 sm:p-8 mt-12">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="bg-blue-100 p-2 rounded-lg">
                                        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-900">{currentLesson.quiz.title}</h3>
                                </div>
                                
                                <div className="space-y-8">
                                    {currentLesson.quiz.questions.map((q, qIdx) => {
                                        const userAnswer = quizProgress?.answers?.[qIdx];
                                        return (
                                            <div key={qIdx} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
                                                <p className="font-medium text-gray-800 mb-4">
                                                    <span className="text-blue-600 font-semibold">Question {qIdx + 1}.</span> {q.question}
                                                </p>
                                                <div className="space-y-3">
                                                    {q.options.map(opt => {
                                                        const isCorrect = q.correctAnswer === opt;
                                                        const isSelected = userAnswer === opt;
                                                        let optionClass = "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ";
                                                        
                                                        if (isQuizSubmitted) {
                                                            if (isCorrect) { 
                                                                optionClass += 'bg-green-50 border-green-200 text-green-800';
                                                            } else if (isSelected && !isCorrect) { 
                                                                optionClass += 'bg-red-50 border-red-200 text-red-800';
                                                            } else { 
                                                                optionClass += 'bg-white border-gray-200 text-gray-600';
                                                            }
                                                        } else {
                                                            optionClass += 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700';
                                                        }

                                                        return (
                                                            <label key={opt} className={optionClass}>
                                                                <input 
                                                                    type="radio" 
                                                                    name={`q_${qIdx}`} 
                                                                    value={opt} 
                                                                    onChange={() => handleQuizAnswer(qIdx, opt)} 
                                                                    disabled={isQuizSubmitted} 
                                                                    checked={isSelected} 
                                                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300" 
                                                                />
                                                                <span className="flex-1">{opt}</span>
                                                                {isQuizSubmitted && isCorrect && (
                                                                    <span className="text-green-500">
                                                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </span>
                                                                )}
                                                                {isQuizSubmitted && isSelected && !isCorrect && (
                                                                    <span className="text-red-500">
                                                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </span>
                                                                )}
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Quiz Actions */}
                                    <div className="mt-8 flex flex-col sm:flex-row gap-3">
                                        {!isQuizSubmitted ? (
                                            <button 
                                                onClick={handleSubmitQuiz} 
                                                disabled={isSubmittingQuiz}
                                                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition-colors flex-1 sm:flex-none sm:w-auto flex items-center gap-2"
                                            >
                                                {isSubmittingQuiz && (
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                )}
                                                {isSubmittingQuiz ? 'Submitting...' : 'Submit Quiz'}
                                            </button>
                                        ) : (
                                            <div className={`w-full border rounded-xl p-6 text-center ${
                                                quizResponse?.passed 
                                                    ? 'bg-white border-green-100' 
                                                    : 'bg-red-50 border-red-200'
                                            }`}>
                                                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
                                                    quizResponse?.passed 
                                                        ? 'bg-green-50 text-green-500' 
                                                        : 'bg-red-100 text-red-500'
                                                }`}>
                                                    {quizResponse?.passed ? (
                                                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                            </svg>
                                                        ) : (
                                                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <h4 className={`text-xl font-bold mb-1 ${
                                                    quizResponse?.passed ? 'text-gray-900' : 'text-red-800'
                                                }`}>
                                                    {quizResponse?.passed ? 'Quiz Passed!' : 'Quiz Failed'}
                                                </h4>
                                                <p className={`mb-6 ${
                                                    quizResponse?.passed ? 'text-gray-600' : 'text-red-700'
                                                }`}>
                                                    You scored <span className={`font-bold ${
                                                        quizResponse?.passed ? 'text-blue-600' : 'text-red-600'
                                                    }`}>{quizResponse?.percentage || quizResult?.score}%</span> 
                                                    ({quizResult?.correct} out of {quizResult?.total} correct)
                                                </p>
                                                {quizResponse?.passed ? (
                                                    <div>
                                                        {quizResponse.chapterCompleted ? (
                                                            <div>
                                                                <div className="flex items-center gap-2 text-green-700 mb-2 font-medium">
                                                                    <PartyPopper className="w-5 h-5" />
                                                                    <span>Chapter Completed!</span>
                                                                </div>
                                                                <p className="text-green-600 mb-4 text-sm">
                                                                    You've mastered all lessons in this chapter. Next chapter is now unlocked!
                                                                </p>
                                                                <div className="flex flex-col sm:flex-row gap-3">
                                                                    <button 
                                                                        onClick={() => {
                                                                            // Move to first lesson of next chapter
                                                                            const nextChapter = activeLesson!.chap + 1;
                                                                            if (nextChapter < course.chapters.length) {
                                                                                setActiveLesson({ chap: nextChapter, less: 0 });
                                                                                setIsQuizSubmitted(false);
                                                                                setQuizResult(null);
                                                                                setQuizResponse(null);
                                                                            }
                                                                        }}
                                                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors w-full sm:w-auto"
                                                                    >
                                                                        Continue to Next Chapter
                                                                    </button>
                                                                    <button 
                                                                        onClick={handleContinue} 
                                                                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-sm transition-colors w-full sm:w-auto"
                                                                    >
                                                                        Stay in Current Chapter
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div>
                                                                <div className="flex items-center gap-2 text-green-700 mb-4 font-medium">
                                                                    <PartyPopper className="w-5 h-5" />
                                                                    <span>Congratulations! Next lesson unlocked!</span>
                                                                </div>
                                                                <button 
                                                                    onClick={handleContinue} 
                                                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-sm transition-colors w-full sm:w-auto"
                                                                >
                                                                    Continue to Next Lesson
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <p className="text-red-700 mb-4 font-medium">
                                                            You need 50% to unlock the next lesson. Try again!
                                                        </p>
                                                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                                            <button 
                                                                onClick={handleTryAgain}
                                                                disabled={isRegeneratingQuiz}
                                                                className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition-colors w-full sm:w-auto flex items-center gap-2 justify-center"
                                                            >
                                                                {isRegeneratingQuiz && (
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                                )}
                                                                {isRegeneratingQuiz ? 'Generating New Questions...' : 'Try Again with New Questions'}
                                                            </button>
                                                        </div>
                                                        {quizResponse?.attempts && (
                                                            <p className="text-sm text-red-600 mt-3">
                                                                Attempt {quizResponse.attempts} • Keep trying, you can do it!
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Mark Complete Button (for non-quiz lessons) */}
                        {!currentLesson.completed && !currentLesson.quiz && activeLesson && currentLesson.unlocked !== false && (
                            <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                                <button 
                                    onClick={() => onMarkComplete(course.id, activeLesson.chap, activeLesson.less, currentLesson.xp)} 
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Mark as Complete
                                </button>
                            </div>
                        )}

                        {/* Completion Badge */}
                        {currentLesson.completed && (
                            <div className="mt-8 p-4 bg-green-50 border border-green-100 rounded-xl flex items-center gap-3">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div>
                                    <h4 className="font-medium text-green-800">Lesson Completed!</h4>
                                    <p className="text-sm text-green-600">Great job! You've earned {currentLesson.xp} XP.</p>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 mb-4">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-1">Select a lesson to begin</h3>
                        <p className="text-gray-500">Choose a lesson from the sidebar to start learning</p>
                    </div>
                )}
            </main>
        </div>
    );
};

export default LearningView;
