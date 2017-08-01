import React from 'react';
import '../Styles/Project.less';
import DisplayText from '../Components/DisplayText';
import ActiveBackground from '../Components/ActiveBackgound';


export default class Intro extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div className="intro">
                <ActiveBackground />
                <div className="my-info">
                    <h1>
                        Robert Hill
                    </h1>
                    <DisplayText />
                </div>
            </div>
        )
    }
}
