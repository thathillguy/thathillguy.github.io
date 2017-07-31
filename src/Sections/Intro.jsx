import React from 'react';
import '../Styles/Project.less';


export default class Intro extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div className="intro">
                <div className="my-info">
                    <h1>
                        Robert Hill
                    </h1>
                    <h2>
                        Student
                    </h2>
                </div>
            </div>
        )
    }
}
